/**
 * A journaled `WorkflowEngine`. The fiber logic is Effect 4.1.1's
 * `WorkflowEngine.layerMemory` (MIT), unchanged where it could be. What
 * changes is where state lives: run rows, step results and resolved
 * deferreds go to a {@link Store}, so another engine over the same store,
 * after a crash or in a new process, resumes the run and serves every
 * finished step from the journal instead of running it again.
 *
 * @internal
 */
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as FiberMap from "effect/FiberMap"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import { Workflow, WorkflowEngine } from "effect/workflow"
import type { Activity } from "effect/workflow"
import { sortCollections } from "./canonical.js"
import { isTerminal, type JournalEntry, type NewEvent, type RunRow, type RunStatus, type Store } from "./durableStore.js"

const WorkflowInstance = WorkflowEngine.WorkflowInstance
type Instance = WorkflowEngine.WorkflowInstance["Service"]

/** Activity and deferred exits as stored: values already encoded by their schemas. */
const ExitJson = Schema.toCodecJson(Schema.Exit(Schema.Unknown, Schema.Unknown, Schema.Defect()))
const toJsonExit = Exit.map((value: unknown) => value ?? null)
export const encodeExit = (exit: Exit.Exit<unknown, unknown>): unknown => Schema.encodeSync(ExitJson)(toJsonExit(exit))
export const decodeExit = (json: unknown): Exit.Exit<unknown, unknown> => Schema.decodeUnknownSync(ExitJson)(json)

const resultCodec = (workflow: Workflow.Any) =>
  Schema.toCodecJson(Workflow.Result({ success: workflow.successSchema, error: workflow.errorSchema })) as unknown as Schema.Codec<
    Workflow.Result<unknown, unknown>,
    unknown
  >
const payloadCodec = (workflow: Workflow.Any) =>
  Schema.toCodecJson(workflow.payloadSchema) as unknown as Schema.Codec<object, unknown>

/** The payload as VIP-44 hashes it: sets and maps sorted, then encoded. */
export const encodePayload = (workflow: Workflow.Any, payload: object): unknown =>
  Schema.encodeSync(payloadCodec(workflow))(sortCollections(payload))
export const decodePayload = (workflow: Workflow.Any, json: unknown): object => Schema.decodeUnknownSync(payloadCodec(workflow))(json)

const statusOf = (result: Workflow.Result<unknown, unknown>): RunStatus => {
  if (result._tag === "Suspended") return "suspended"
  if (Exit.isSuccess(result.exit)) return "succeeded"
  return Cause.hasInterruptsOnly(result.exit.cause) ? "interrupted" : "failed"
}

/** The step annotations the journal records with `StepStarted`. */
export class StepInfo extends Context.Reference<Record<string, unknown>>("vibelang/experimental/Durable/StepInfo", {
  defaultValue: () => ({})
}) {}

type ResumeMode = "explicit" | "automatic"

interface Execution {
  payload: object
  readonly workflow: Workflow.Any
  readonly execute: (payload: object, executionId: string) => Effect.Effect<unknown, unknown, WorkflowEngine.WorkflowInstance | WorkflowEngine.WorkflowEngine>
  instance: Instance
  interrupted: boolean
  interruptedUnsafe: boolean
  resumeRequested: ResumeMode | undefined
  fiber: Fiber.Fiber<Workflow.Result<unknown, unknown>, unknown> | undefined
  readonly done: Deferred.Deferred<void>
  readonly scope: Scope.Closeable
  readonly parent: string | undefined
  fence: number
  /** `name/attempt` to the encoded exit of every finished step. */
  readonly steps: Map<string, unknown>
  /** Deferred name to its encoded exit. */
  readonly deferreds: Map<string, unknown>
  /** Durable clock name to the time it wakes, in epoch milliseconds. */
  readonly clocks: Map<string, number>
}

interface Registered {
  readonly workflow: Workflow.Any
  readonly execute: (payload: object, executionId: string) => Effect.Effect<unknown, unknown, WorkflowEngine.WorkflowInstance | WorkflowEngine.WorkflowEngine>
  readonly scope: Scope.Scope
}

/** What the rest of `Experimental.Durable` needs from a running engine. */
export interface EngineInternals {
  readonly store: Store
  readonly owner: string
  /** True while this engine is driving the run. */
  readonly isLive: (run: string) => boolean
  /** Forgets a run that is not live, so the next execute reloads it from the store. */
  readonly evict: (run: string) => void
  readonly workflow: (tag: string) => Workflow.Any | undefined
}

const isUnwakeable = (result: Workflow.Result<unknown, unknown>, mode: ResumeMode) =>
  result._tag === "Complete" || (mode === "automatic" && result.failed === true)

const indexEntries = (
  entries: ReadonlyArray<JournalEntry>,
  steps: Map<string, unknown>,
  deferreds: Map<string, unknown>,
  clocks: Map<string, number>
) => {
  for (const entry of entries) {
    const payload = entry.payload as Record<string, unknown>
    if (entry.eventType === "StepCompleted") steps.set(`${payload.step}/${payload.attempt}`, payload.exit)
    else if (entry.eventType === "DeferredDone" && !deferreds.has(payload.name as string)) deferreds.set(payload.name as string, payload.exit)
    else if (entry.eventType === "ClockScheduled" && !clocks.has(payload.name as string)) clocks.set(payload.name as string, payload.wakeAt as number)
  }
}

export const make = (store: Store) =>
  Effect.gen(function*() {
    const scope = yield* Effect.scope
    const owner = globalThis.crypto.randomUUID()
    const workflows = new Map<string, Registered>()
    const executions = new Map<string, Execution>()
    const deferredState = WorkflowEngine.makeDeferredState()
    const loading = Semaphore.makeUnsafe(1)
    const now = Clock.currentTimeMillis

    const commit = (state: Execution, run: string, events: ReadonlyArray<NewEvent>, update?: { status: RunStatus; result?: unknown }) =>
      Effect.flatMap(now, (at) =>
        store.commit(run, { fence: state.fence, events, status: update?.status, result: update?.result }, at)
      ).pipe(Effect.orDie)

    const persistResult = (state: Execution, run: string, result: Workflow.Result<unknown, unknown>) => {
      const status = statusOf(result)
      if (result._tag === "Suspended") return commit(state, run, [{ eventType: "RunSuspended", payload: {} }], { status })
      const encoded = Schema.encodeSync(resultCodec(state.workflow))(result)
      return commit(state, run, [{ eventType: "RunCompleted", payload: { status, result: encoded } }], { status, result: encoded })
    }

    const resume: (executionId: string, mode: ResumeMode) => Effect.Effect<void> = Effect.fnUntraced(function*(executionId: string, mode: ResumeMode) {
      const state = executions.get(executionId)
      if (!state) return
      const exit = state.fiber?.pollUnsafe()
      if (exit && exit._tag === "Success" && isUnwakeable(exit.value, mode)) {
        return
      } else if (state.fiber && !exit) {
        const requested = state.resumeRequested
        state.resumeRequested = mode === "explicit" ? mode : requested ?? mode
        if (requested === undefined) {
          yield* Fiber.await(state.fiber).pipe(
            Effect.flatMap(() => {
              const next = state.resumeRequested!
              state.resumeRequested = undefined
              return resume(executionId, next)
            }),
            Effect.forkIn(scope)
          )
        }
        return
      }
      // A signal written by another process is in the journal, not in memory.
      indexEntries(yield* store.entries(executionId), state.steps, state.deferreds, state.clocks)
      const entry = workflows.get(state.workflow._tag)!
      const instance = WorkflowInstance.initial(state.workflow, executionId, { scope: Scope.forkUnsafe(state.scope) })
      state.instance = instance
      state.fiber = (yield* state.execute(state.payload, executionId).pipe(
        Effect.onExit((exit) => {
          if (
            !state.interrupted ||
            (!state.interruptedUnsafe && !instance.suspended && !instance.abandoned &&
              !(Context.get(instance.workflow.annotations, Workflow.SuspendOnFailure) && Exit.isFailure(exit)))
          ) {
            return Effect.void
          }
          instance.interrupted = true
          instance.suspended = false
          return Effect.withFiber((fiber) => Effect.interruptible(Fiber.interrupt(fiber)))
        }),
        Workflow.intoResult,
        Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
        (effect) => deferredState.trackRun(instance, effect),
        Effect.tap((result) => persistResult(state, executionId, result)),
        Effect.tap((result) => {
          if (!state.parent || result._tag !== "Complete") return Effect.void
          return Effect.forkIn(resume(state.parent, "automatic"), scope)
        }),
        Effect.onExit((exit) => {
          if (Exit.isSuccess(exit) && exit.value._tag === "Suspended") return Effect.void
          return Effect.andThen(
            Scope.close(state.scope, Exit.void),
            Exit.isSuccess(exit) && exit.value._tag === "Complete" ? Deferred.succeed(state.done, void 0) : Effect.void
          )
        }),
        Effect.forkIn(entry.scope)
      )) as Fiber.Fiber<Workflow.Result<unknown, unknown>, unknown>
    })

    /** Builds this engine's state for a run, creating the stored run if it is new. */
    const load = (entry: Registered, executionId: string, payload: object | undefined, parent: string | undefined, row: RunRow | undefined) =>
      Effect.gen(function*() {
        const at = yield* now
        if (row === undefined) {
          if (payload === undefined) return undefined
          row = yield* store.open({ run: executionId, workflow: entry.workflow._tag, payload: encodePayload(entry.workflow, payload), parent, at })
        }
        const fence = yield* Effect.orDie(store.claim(executionId, owner, at))
        const steps = new Map<string, unknown>()
        const deferreds = new Map<string, unknown>()
        const clocks = new Map<string, number>()
        indexEntries(yield* store.entries(executionId), steps, deferreds, clocks)
        const state: Execution = {
          // The body sees the stored snapshot, so the hash covers exactly what it reads.
          payload: decodePayload(entry.workflow, row.payload),
          workflow: entry.workflow,
          execute: entry.execute,
          instance: WorkflowInstance.initial(entry.workflow, executionId),
          interrupted: false,
          interruptedUnsafe: false,
          resumeRequested: undefined,
          fiber: undefined,
          done: Deferred.makeUnsafe(),
          scope: Scope.makeUnsafe(),
          parent: row.parent,
          fence,
          steps,
          deferreds,
          clocks
        }
        executions.set(executionId, state)
        return state
      })

    /** This engine's state for a stored, unfinished run, loading it when needed. */
    const ensure = (executionId: string) =>
      loading.withPermits(1)(Effect.gen(function*() {
        const known = executions.get(executionId)
        if (known) return known
        const row = yield* store.get(executionId)
        if (Option.isNone(row) || isTerminal(row.value.status)) return undefined
        const entry = workflows.get(row.value.workflow)
        if (!entry) return undefined
        const state = yield* load(entry, executionId, undefined, undefined, row.value)
        return state
      }))

    const clocks = yield* FiberMap.make<string>()

    const engine: WorkflowEngine.WorkflowEngine["Service"] = WorkflowEngine.makeUnsafe({
      register: Effect.fnUntraced(function*(workflow, execute) {
        workflows.set(workflow._tag, { workflow, execute: execute as Registered["execute"], scope: yield* Effect.scope })
      }),
      execute: Effect.fnUntraced(function*(workflow, options) {
        const entry = workflows.get(workflow._tag)
        if (!entry) {
          return yield* Effect.die(`Workflow ${workflow._tag} is not registered`)
        }
        const started = yield* loading.withPermits(1)(Effect.gen(function*() {
          const known = executions.get(options.executionId)
          if (known) return { state: known, stored: undefined }
          const row = yield* store.get(options.executionId)
          if (Option.isSome(row) && isTerminal(row.value.status)) return { state: undefined, stored: row.value }
          const state = yield* load(
            entry,
            options.executionId,
            options.payload,
            options.detached ? undefined : options.parent?.executionId,
            Option.getOrUndefined(row)
          )
          yield* resume(options.executionId, "explicit")
          return { state, stored: undefined }
        }))
        if (started.stored) {
          // A finished run is joined: its recorded result, and nothing runs.
          if (options.discard) return undefined as any
          return Schema.decodeUnknownSync(resultCodec(workflow))(started.stored.result) as any
        }
        const state = started.state!
        if (options.discard) return undefined as any
        const instance = state.instance
        const exit = yield* Fiber.await(state.fiber!)
        if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause) && instance.suspended) {
          return new Workflow.Suspended({}) as any
        }
        return yield* (exit as Exit.Exit<any, never>)
      }),
      awaitComplete: (_workflow, executionId) =>
        Effect.suspend(() => {
          const state = executions.get(executionId)
          return state ? Deferred.await(state.done) : Effect.never
        }),
      interrupt: Effect.fnUntraced(function*(_workflow, executionId) {
        const state = yield* ensure(executionId)
        if (!state) return
        state.interrupted = true
        yield* resume(executionId, "explicit")
      }),
      interruptUnsafe: Effect.fnUntraced(function*(_workflow, executionId) {
        const state = yield* ensure(executionId)
        if (!state) return
        state.interrupted = true
        state.interruptedUnsafe = true
        if (state.fiber) {
          yield* Fiber.interrupt(state.fiber)
        }
        yield* resume(executionId, "explicit")
      }),
      resume: (_workflow, executionId) =>
        Effect.flatMap(ensure(executionId), (state) => state ? resume(executionId, "explicit") : Effect.void),
      activityExecute: Effect.fnUntraced(function*(activity: Activity.Any, attempt: number) {
        const instance = yield* WorkflowInstance
        const state = executions.get(instance.executionId)
        if (!state) return yield* Effect.die(`Run ${instance.executionId} is not loaded`)
        const stepId = `${activity.name}/${attempt}`
        const recorded = state.steps.get(stepId)
        if (recorded !== undefined) {
          return new Workflow.Complete({ exit: decodeExit(recorded) })
        }
        // A pending interrupt replays only to rebuild compensations, so it must
        // not run new activities. Finalizers run once `interrupted` is set.
        if (state.interrupted && !instance.interrupted) {
          return new Workflow.Suspended({})
        }
        const info = yield* StepInfo
        yield* commit(state, instance.executionId, [{ eventType: "StepStarted", payload: { ...info, step: activity.name, attempt } }])
        const activityInstance = WorkflowInstance.initial(instance.workflow, instance.executionId)
        activityInstance.interrupted = instance.interrupted
        return yield* activity.executeEncoded.pipe(
          Workflow.intoResult,
          Effect.provideService(WorkflowInstance, activityInstance),
          Effect.tap((result) => {
            if (result._tag !== "Complete") return Effect.void
            const exit = encodeExit(result.exit)
            // The event and the step's state commit together.
            return Effect.andThen(
              commit(state, instance.executionId, [{ eventType: "StepCompleted", payload: { step: activity.name, attempt, exit } }]),
              Effect.sync(() => void state.steps.set(stepId, exit))
            )
          })
        )
      }),
      poll: (workflow, executionId) =>
        Effect.suspend(() => {
          const state = executions.get(executionId)
          if (state) {
            const exit = state.fiber?.pollUnsafe()
            if (!exit) return Effect.succeedNone
            return exit._tag === "Success" ? Effect.succeedSome(exit.value) : Effect.die(exit.cause)
          }
          return Effect.map(store.get(executionId), (row) => {
            if (Option.isNone(row)) return Option.none()
            if (row.value.status === "suspended") return Option.some(new Workflow.Suspended({}) as Workflow.Result<unknown, unknown>)
            if (!isTerminal(row.value.status)) return Option.none()
            return Option.some(Schema.decodeUnknownSync(resultCodec(workflow))(row.value.result))
          })
        }),
      deferredResult: Effect.fnUntraced(function*(deferred) {
        const instance = yield* WorkflowInstance
        const json = executions.get(instance.executionId)?.deferreds.get(deferred.name)
        return json === undefined ? Option.none() : Option.some(decodeExit(json))
      }),
      deferredDone: (options) =>
        Effect.gen(function*() {
          const state = executions.get(options.executionId)
          if (state?.deferreds.has(options.deferredName)) return
          const exit = encodeExit(options.exit)
          // A signal is not the owner's write, so it is appended unfenced.
          yield* Effect.orDie(Effect.flatMap(now, (at) =>
            store.append(options.executionId, [{ eventType: "DeferredDone", payload: { name: options.deferredName, exit } }], at)
          ))
          if (!state) return
          state.deferreds.set(options.deferredName, exit)
          const wake = Effect.andThen(
            deferredState.deferredDone(options.executionId, options.deferredName),
            resume(options.executionId, "automatic")
          )
          const current = yield* Effect.serviceOption(WorkflowInstance)
          if (Option.isSome(current) && current.value.executionId === options.executionId) {
            yield* Effect.forkIn(wake, scope)
          } else {
            yield* wake
          }
        }),
      // A clock's wake time is journaled once, so a run resumed after a
      // crash waits only for what is left of it.
      scheduleClock: (workflow, options) =>
        Effect.gen(function*() {
          const state = executions.get(options.executionId)
          const at = yield* now
          let wakeAt = state?.clocks.get(options.clock.name)
          if (wakeAt === undefined) {
            wakeAt = at + Duration.toMillis(options.clock.duration)
            if (state) {
              yield* commit(state, options.executionId, [{ eventType: "ClockScheduled", payload: { name: options.clock.name, wakeAt } }])
              state.clocks.set(options.clock.name, wakeAt)
            }
          }
          yield* engine.deferredDone(options.clock.deferred, {
            workflowName: workflow._tag,
            executionId: options.executionId,
            deferredName: options.clock.deferred.name,
            exit: Exit.void
          }).pipe(
            Effect.delay(Math.max(0, wakeAt - at)),
            FiberMap.run(clocks, `${options.executionId}/${options.clock.name}`, { onlyIfMissing: true })
          )
        })
    } as WorkflowEngine.Encoded)

    const internals: EngineInternals = {
      store,
      owner,
      isLive: (run) => {
        const state = executions.get(run)
        return state !== undefined && state.fiber !== undefined && state.fiber.pollUnsafe() === undefined
      },
      evict: (run) => {
        const state = executions.get(run)
        if (state && !(state.fiber !== undefined && state.fiber.pollUnsafe() === undefined)) executions.delete(run)
      },
      workflow: (tag) => workflows.get(tag)?.workflow
    }
    return { engine, internals } as const
  })
