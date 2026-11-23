/**
 * Cron triggers: start a workflow on a schedule, once per occurrence, from
 * a durable row that several hosts can share.
 *
 * {@link cron} declares a schedule for a declared `workflow`, whose `input`
 * is its parameter tuple, or for one of Effect's workflows, whose `input` is
 * its payload. A wrong input is a type error.
 * {@link layer} registers triggers in a {@link Store} and runs the scheduler
 * for the life of its scope. The scheduler launches runs through the
 * {@link Runner} port; {@link layerRunnerDurable} is the adapter over
 * `Experimental.Durable`'s engine. Effect's `Cron` parses and steps the
 * expressions.
 *
 * Guarantees:
 *
 * - A trigger is a durable row. The scheduler deciding for it holds a lease
 *   on the row, so two hosts over one store decide each occurrence once.
 * - One occurrence starts one run. Dispatch is at-least-once: a host that
 *   dies after deciding a launch leaves the occurrence `claimed`, and the
 *   next lease holder launches it again. Each occurrence has one idempotency
 *   key, the trigger id and the scheduled instant, and the engine runs one
 *   run per key, so the retry joins the run already started.
 * - Two occurrences are two runs, even with equal input.
 * - Catch-up is bounded. Occurrences that passed while no scheduler ran are
 *   owed by `catchUp`: none of them, the newest one, or the newest
 *   `maxCatchUp` of them. The ledger records the rest as `missed`.
 * - A trigger grants nothing: a run it starts has the services of the
 *   scheduler's scope, as a run started by hand would.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Cron from "effect/Cron"
import * as Data from "effect/Data"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import type { SqlClient } from "effect/sql"
import { type Workflow, WorkflowEngine } from "effect/workflow"
import { engineLaunch, engineWorkflow, isDeclaredWorkflow, type Workflow as DeclaredWorkflow } from "../durable.js"
import { Durable, type Signal } from "./Durable.js"
import * as canonical from "./internal/canonical.js"
import * as sqlStore from "./internal/triggerSql.js"
import * as store from "./internal/triggerStore.js"

/**
 * @category type ids
 * @since 0.0.13
 */
export type TypeId = "~vibelang/experimental/Trigger"

/**
 * @category type ids
 * @since 0.0.13
 */
export const TypeId: TypeId = "~vibelang/experimental/Trigger"

/**
 * Why a declaration was refused or a launch failed.
 *
 * - `invalid_cron`: not five fields, or a field Effect's `Cron` cannot read.
 * - `unsatisfiable_cron`: an expression no date satisfies, such as `0 0 30 2 *`.
 * - `invalid_timezone`: not an IANA zone.
 * - `invalid_input`: the input is not the workflow's payload.
 * - `invalid_options`: an option outside its values, or a duplicate id.
 * - `runner`: the {@link Runner} could not start, inspect or cancel a run, or
 *   deliver a signal to it.
 *
 * @category errors
 * @since 0.0.13
 */
export type TriggerErrorCode =
  | "invalid_cron"
  | "unsatisfiable_cron"
  | "invalid_timezone"
  | "invalid_input"
  | "invalid_options"
  | "runner"

/**
 * @category errors
 * @since 0.0.13
 */
export class TriggerError extends Data.TaggedError("TriggerError")<{
  readonly code: TriggerErrorCode
  readonly message: string
  /** The option the failure belongs to. */
  readonly path?: string | undefined
}> {}

/**
 * What an occurrence that comes while the trigger's last run is still going
 * does: `skip` drops it, `buffer-one` keeps the newest one and launches it
 * when the run ends, and `supersede` cancels the run and launches it.
 *
 * @category models
 * @since 0.0.13
 */
export type Overlap = "skip" | "buffer-one" | "supersede"

/**
 * What a scheduler owes for occurrences that passed while none ran:
 * nothing, the newest one, or the newest `maxCatchUp`.
 *
 * @category models
 * @since 0.0.13
 */
export type CatchUp = "none" | "one" | "all"

// Effect's own widest workflow type. A narrower `Workflow<string, …>` refuses
// every concrete workflow under `strictFunctionTypes`, through `idempotencyKey`.
type AnyWorkflow = Workflow.Any

// A declared `workflow` (VIP-55), of any parameters.
type AnyDeclared = DeclaredWorkflow<any, any, any, any, any>

/**
 * What a trigger starts: a declared `workflow`, or one of Effect's workflows.
 *
 * @category models
 * @since 0.0.13
 */
export type Target = AnyWorkflow | AnyDeclared

/**
 * What `W` starts with: a declared workflow's parameter tuple, or an Effect
 * workflow's payload. TypeScript infers a function's returned array literal
 * as an array before it knows `W`, so a mapping that returns the tuple
 * writes `as const` or names its return type.
 *
 * @category models
 * @since 0.0.13
 */
export type Input<W extends Target> = W extends DeclaredWorkflow<infer P, any, any, any, any> ? Readonly<P>
  : W extends AnyWorkflow ? Schema.Struct.Type<W["payloadSchema"]["fields"]>
  : never

// The Effect workflow and payload a target and its input launch.
const resolve = (target: Target, input: unknown): Effect.Effect<{ readonly workflow: AnyWorkflow; readonly payload: unknown }, string> => {
  if (!isDeclaredWorkflow(target)) return Effect.succeed({ workflow: target as AnyWorkflow, payload: input })
  const arity = Object.keys(target.schemas.payload).length
  if (!Array.isArray(input) || input.length !== arity) {
    return Effect.fail(`input must be ${target.key}'s ${arity} arguments, as an array`)
  }
  return engineLaunch(target, input)
}

const nameOf = (target: Target) => (isDeclaredWorkflow(target) ? target.key : (target as AnyWorkflow)._tag)

/**
 * The options of {@link cron}.
 *
 * @category models
 * @since 0.0.13
 */
export interface CronOptions<W extends Target> {
  /** A stable name. The store keys the trigger's row and ledger by it. */
  readonly id: string
  /** Five fields: minute, hour, day of month, month, day of week. */
  readonly cron: string
  /** An IANA zone the fields are read in. Defaults to `"UTC"`. */
  readonly timezone?: string | undefined
  /** What every run starts with: `W`'s arguments, or its payload. */
  readonly input: Input<W>
  /** Defaults to `"skip"`. */
  readonly overlap?: Overlap | undefined
  /** Defaults to `"none"`. */
  readonly catchUp?: CatchUp | undefined
  /**
   * The most missed occurrences one start of the scheduler launches. Must be
   * 0 or absent under `"none"`, defaults to 1 under `"one"`, and is required
   * under `"all"`, from 1 to {@link maxCatchUpLimit}.
   */
  readonly maxCatchUp?: number | undefined
  /** A disabled trigger launches nothing and owes nothing for the time it was disabled. Defaults to `true`. */
  readonly enabled?: boolean | undefined
}

/**
 * A declared schedule for a workflow, as {@link cron} returns it.
 *
 * @category models
 * @since 0.0.13
 */
export interface Trigger<W extends Target = Target> {
  readonly [TypeId]: TypeId
  readonly id: string
  readonly workflow: W
  readonly input: Input<W>
  /** The Effect workflow and payload each run starts with; for a declared workflow, `input` by parameter name. */
  readonly launch: { readonly workflow: AnyWorkflow; readonly payload: object }
  readonly cron: string
  readonly timezone: string
  readonly overlap: Overlap
  readonly catchUp: CatchUp
  readonly maxCatchUp: number
  readonly enabled: boolean
  /** The parsed expression. */
  readonly schedule: Cron.Cron
}

/**
 * The greatest `maxCatchUp`.
 *
 * @category constants
 * @since 0.0.13
 */
export const maxCatchUpLimit = 1000

const refuse = (code: TriggerErrorCode, message: string, path?: string) => Effect.fail(new TriggerError({ code, message, path }))

const overlaps: ReadonlyArray<Overlap> = ["skip", "buffer-one", "supersede"]
const catchUps: ReadonlyArray<CatchUp> = ["none", "one", "all"]

/**
 * Declares a schedule for workflow `W`. Fails with {@link TriggerError}
 * when the expression is malformed or matches no date, the zone is unknown,
 * the input is not `W`'s payload, or an option is outside its values.
 * Nothing runs until {@link layer} registers the trigger.
 *
 * @category constructors
 * @since 0.0.13
 */
export const cron = <W extends Target>(workflow: W, options: CronOptions<W>): Effect.Effect<Trigger<W>, TriggerError> =>
  Effect.gen(function*() {
    if (typeof options.id !== "string" || options.id.length === 0) return yield* refuse("invalid_options", "id must be a non-empty string", "id")
    const timezone = options.timezone ?? "UTC"
    const zone = DateTime.zoneMakeNamed(timezone)
    if (Option.isNone(zone)) return yield* refuse("invalid_timezone", `"${timezone}" is not an IANA time zone`, "timezone")
    const fields = typeof options.cron === "string" ? options.cron.trim().split(/\s+/) : []
    if (fields.length !== 5) {
      return yield* refuse("invalid_cron", `"${options.cron}" is not a five-field cron expression`, "cron")
    }
    const parsed = Cron.parse(options.cron, zone.value)
    if (Result.isFailure(parsed)) return yield* refuse("invalid_cron", parsed.failure.message, "cron")
    const now = yield* Clock.currentTimeMillis
    // Effect's search throws when it finds no date in its bound.
    if (Result.isFailure(Result.try(() => Cron.next(parsed.success, new Date(now))))) {
      return yield* refuse("unsatisfiable_cron", `"${options.cron}" matches no date`, "cron")
    }
    const overlap = options.overlap ?? "skip"
    if (!overlaps.includes(overlap)) return yield* refuse("invalid_options", `overlap must be one of ${overlaps.join(", ")}`, "overlap")
    const catchUp = options.catchUp ?? "none"
    if (!catchUps.includes(catchUp)) return yield* refuse("invalid_options", `catchUp must be one of ${catchUps.join(", ")}`, "catchUp")
    const stated = options.maxCatchUp
    if (stated !== undefined && (!Number.isSafeInteger(stated) || stated < 0 || stated > maxCatchUpLimit)) {
      return yield* refuse("invalid_options", `maxCatchUp must be an integer from 0 to ${maxCatchUpLimit}`, "maxCatchUp")
    }
    if (catchUp === "none" && stated !== undefined && stated !== 0) {
      return yield* refuse("invalid_options", `catchUp "none" owes no missed occurrence, so maxCatchUp must be 0`, "maxCatchUp")
    }
    if (catchUp === "one" && stated === 0) {
      return yield* refuse("invalid_options", `catchUp "one" owes one missed occurrence, so maxCatchUp cannot be 0`, "maxCatchUp")
    }
    if (catchUp === "all" && (stated === undefined || stated === 0)) {
      return yield* refuse("invalid_options", `catchUp "all" needs maxCatchUp, the most missed occurrences it launches`, "maxCatchUp")
    }
    const enabled = options.enabled ?? true
    if (typeof enabled !== "boolean") return yield* refuse("invalid_options", "enabled must be a boolean", "enabled")
    const resolved = yield* Effect.mapError(resolve(workflow, options.input), (message) =>
      new TriggerError({ code: "invalid_input", message, path: "input" }))
    const input = Result.try(() => resolved.workflow.payloadSchema.make(resolved.payload))
    if (Result.isFailure(input)) {
      return yield* refuse("invalid_input", `input is not a payload of ${nameOf(workflow)}: ${String(input.failure)}`, "input")
    }
    return {
      [TypeId]: TypeId,
      id: options.id,
      workflow,
      input: options.input,
      launch: { workflow: resolved.workflow, payload: resolved.payload as object },
      cron: options.cron,
      timezone,
      overlap,
      catchUp,
      maxCatchUp: catchUp === "none" ? 0 : catchUp === "one" ? 1 : stated!,
      enabled,
      schedule: parsed.success
    }
  })

/**
 * What a {@link Runner} reports about a run: `active` while it runs or
 * waits, and once it stopped how it ended. `missing` is a run the runner has
 * no record of.
 *
 * @category models
 * @since 0.0.13
 */
export type RunState = "active" | "completed" | "failed" | "cancelled" | "missing"

/**
 * One launch: the workflow, its payload, and the key that names the
 * occurrence. A runner starts at most one run per key: starting the same key
 * again returns the run it started.
 *
 * @category models
 * @since 0.0.13
 */
export interface Launch {
  readonly workflow: AnyWorkflow
  readonly payload: object
  readonly idempotencyKey: string
}

/**
 * One signal delivery: the value for a run's wait on `signal`, at the wait
 * point `point`, or the signal's own point when it is absent. The first
 * delivery to a wait point wins; a later one changes nothing.
 *
 * @category models
 * @since 0.0.13
 */
export interface SignalDelivery {
  readonly workflow: AnyWorkflow
  readonly run: string
  readonly signal: Signal<string, Schema.Top>
  readonly value: unknown
  readonly point?: string | undefined
}

/**
 * The port the scheduler launches through. Implement it to start runs on
 * another engine.
 *
 * @category models
 * @since 0.0.13
 */
export interface RunnerService {
  /** Starts the run for `launch.idempotencyKey`, or finds the one it started, and returns its id without waiting for it. */
  readonly start: (launch: Launch) => Effect.Effect<string, TriggerError>
  readonly inspect: (workflow: AnyWorkflow, run: string) => Effect.Effect<RunState, TriggerError>
  readonly cancel: (workflow: AnyWorkflow, run: string) => Effect.Effect<void, TriggerError>
  /** Delivers a signal's value to a run and wakes it. */
  readonly send: (delivery: SignalDelivery) => Effect.Effect<void, TriggerError>
}

/**
 * The service key of the launch port.
 *
 * @category services
 * @since 0.0.13
 */
export const Runner: Context.Service<RunnerService, RunnerService> = /* @__PURE__ */ Context.Service<RunnerService>(
  "vibelang/experimental/Trigger/Runner"
)

const runnerError = (message: string) => (cause: unknown) => new TriggerError({ code: "runner", message: `${message}: ${String(cause)}` })

const guarded = <A, E>(effect: Effect.Effect<A, E>, message: string): Effect.Effect<A, TriggerError> =>
  effect.pipe(Effect.mapError(runnerError(message)), Effect.catchDefect((defect) => Effect.fail(runnerError(message)(defect))))

/**
 * The {@link Runner} over `Experimental.Durable`'s engine. A launch is
 * `engine.execute` with an execution id derived from its key, so starting a
 * key again joins its run, and the run's stored status answers `inspect`.
 * The workflow must be registered with the engine, by its `toLayer`.
 *
 * @category layers
 * @since 0.0.13
 */
export const layerRunnerDurable: Layer.Layer<RunnerService, never, WorkflowEngine.WorkflowEngine | Durable> = /* @__PURE__ */ Layer.effect(
  Runner,
  Effect.gen(function*() {
    const engine = yield* WorkflowEngine.WorkflowEngine
    const durable = yield* Durable
    return Runner.of({
      start: (launch) =>
        guarded(
          Effect.gen(function*() {
            const id = (yield* canonical.sha256(`trigger:${launch.workflow._tag}:${launch.idempotencyKey}`)).slice(0, 32)
            yield* engine.execute(launch.workflow as Workflow.Workflow<string, Workflow.AnyStructSchema, Schema.Top, Schema.Top>, {
              executionId: id,
              payload: launch.workflow.payloadSchema.make(launch.payload),
              discard: true
            })
            return id
            // A payload schema with services of its own is outside this port; the engine dies on it.
          }) as Effect.Effect<string, unknown>,
          `Could not start ${launch.workflow._tag}`
        ),
      inspect: (_workflow, run) =>
        Effect.map(durable.internals.store.get(run), (row): RunState => {
          if (Option.isNone(row)) return "missing"
          switch (row.value.status) {
            case "running":
            case "suspended":
              return "active"
            case "succeeded":
              return "completed"
            case "failed":
              return "failed"
            case "interrupted":
              return "cancelled"
          }
        }),
      cancel: (workflow, run) =>
        guarded(engine.interrupt(workflow as Workflow.Workflow<string, Workflow.AnyStructSchema, Schema.Top, Schema.Top>, run), `Could not cancel ${workflow._tag} run ${run}`),
      send: (delivery) =>
        guarded(
          Effect.provideService(
            delivery.signal.send(delivery.workflow, delivery.run, delivery.value, delivery.point),
            WorkflowEngine.WorkflowEngine,
            engine
            // A signal schema with services of its own is outside this port; the engine dies on it.
          ) as Effect.Effect<void>,
          `Could not deliver ${delivery.signal.name} to ${delivery.workflow._tag} run ${delivery.run}`
        )
    })
  })
)

/**
 * Where triggers live: one row per trigger and its fire ledger. Implement
 * it to put triggers in another database.
 *
 * @category models
 * @since 0.0.13
 */
export type Store = store.Store

/**
 * What became of an occurrence. `claimed` is a launch decided and not yet
 * started: the next scheduler to hold the trigger starts it.
 *
 * @category models
 * @since 0.0.13
 */
export type Outcome = store.Outcome

/**
 * One row of the fire ledger. `occurrence` is the scheduled instant in
 * milliseconds since the epoch.
 *
 * @category models
 * @since 0.0.13
 */
export type Fire = store.FireRow

/**
 * The service key of the trigger store.
 *
 * @category services
 * @since 0.0.13
 */
export const TriggerStore: Context.Service<Store, Store> = /* @__PURE__ */ Context.Service<Store>(
  "vibelang/experimental/Trigger/TriggerStore"
)

/**
 * A store in this process's memory, gone at exit. Schedulers that share one
 * share its rows and leases, which is how a test runs two hosts.
 *
 * @category constructors
 * @since 0.0.13
 */
export const makeMemoryStore: () => Store = store.makeMemory

/**
 * The trigger store service over `store`.
 *
 * @category layers
 * @since 0.0.13
 */
export const layerStore = (triggers: Store): Layer.Layer<Store> => Layer.succeed(TriggerStore, triggers)

/**
 * A fresh memory store and the Durable runner: what a program with
 * `Experimental.Durable.memory` needs to run triggers.
 *
 * @category layers
 * @since 0.0.13
 */
export const memory: Layer.Layer<Store | RunnerService, never, WorkflowEngine.WorkflowEngine | Durable> = /* @__PURE__ */ Layer.merge(
  /* @__PURE__ */ Layer.unwrap(/* @__PURE__ */ Effect.sync(() => layerStore(store.makeMemory()))),
  layerRunnerDurable
)

/**
 * Triggers in a SQL database through Effect's `SqlClient`, and the Durable
 * runner: provide one of Effect's clients, such as `SqliteClient.layer({
 * filename })` from `@effect/sql-sqlite-node` or `PgClient.layer` from
 * `@effect/sql-pg`. Schedulers on several hosts over one database share
 * the rows, leases and ledger. The tables `trigger_rows` and
 * `trigger_fires` are created if missing. A SQL failure is a defect.
 *
 * @category layers
 * @since 0.0.13
 */
export const layerSql: Layer.Layer<Store | RunnerService, never, SqlClient.SqlClient | WorkflowEngine.WorkflowEngine | Durable> = /* @__PURE__ */ Layer
  .merge(
    /* @__PURE__ */ Layer.unwrap(/* @__PURE__ */ Effect.map(/* @__PURE__ */ Effect.orDie(sqlStore.make), layerStore)),
    layerRunnerDurable
  )

/**
 * The fire ledger of one trigger, newest occurrence first.
 *
 * @category ledger
 * @since 0.0.13
 */
export const fires = (id: string): Stream.Stream<Fire, never, Store> =>
  Stream.unwrap(Effect.map(Effect.service(TriggerStore), (triggers) => Stream.fromIterableEffect(triggers.fires(id))))

/**
 * Scheduler timing.
 *
 * @category models
 * @since 0.0.13
 */
export interface LayerOptions {
  /**
   * The longest the scheduler sleeps between looks at its triggers, which
   * bounds how late it notices a finished run or a lost host. It also wakes
   * at every occurrence. Defaults to 1 minute.
   */
  readonly pollInterval?: Duration.Input | undefined
  /**
   * How long a scheduler holds a trigger after its last look. Another host
   * takes the trigger over once the lease expires. Defaults to 5 minutes
   * and must be longer than `pollInterval`.
   */
  readonly lease?: Duration.Input | undefined
}

const positiveMillis = (input: Duration.Input | undefined, fallback: number, path: string): Effect.Effect<number, TriggerError> => {
  if (input === undefined) return Effect.succeed(fallback)
  const duration = Duration.fromInput(input)
  if (Option.isNone(duration) || !Duration.isFinite(duration.value) || Duration.toMillis(duration.value) <= 0) {
    return refuse("invalid_options", `${path} must be a finite positive duration`, path)
  }
  return Effect.succeed(Duration.toMillis(duration.value))
}

/** The idempotency key of one occurrence: the trigger and the scheduled instant. */
const occurrenceKey = (trigger: Trigger, occurrence: number) => `${trigger.id}@${new Date(occurrence).toISOString()}`

const fire = (trigger: Trigger, occurrence: number, outcome: Outcome, at: number, run?: string, detail?: string): Fire => ({
  trigger: trigger.id,
  occurrence,
  outcome,
  run,
  detail,
  at
})

/**
 * The occurrences after `watermark` and at or before `now`, newest first,
 * split at `startedAt`: those since are on time, those before passed while
 * no scheduler ran. The search stops after `maxCatchUpLimit` on-time
 * occurrences or `owed + 1` missed ones, so a long downtime costs nothing.
 */
const due = (trigger: Trigger, watermark: number, now: number, startedAt: number, owed: number) => {
  const onTime: Array<number> = []
  const missed: Array<number> = []
  // `Cron.prev` is strict, so start one millisecond later to include `now`.
  let cursor = new Date(now + 1)
  while (onTime.length < maxCatchUpLimit && missed.length <= owed) {
    cursor = Cron.prev(trigger.schedule, cursor)
    const at = cursor.getTime()
    if (at <= watermark) break
    if (at >= startedAt) onTime.push(at)
    else missed.push(at)
  }
  return { onTime: onTime.reverse(), missed }
}

const make = (triggers: ReadonlyArray<Trigger>, options: { readonly pollMs: number; readonly leaseMs: number }) =>
  Effect.gen(function*() {
    const triggerStore = yield* TriggerStore
    const runner = yield* Runner
    const owner = globalThis.crypto.randomUUID()
    const startedAt = yield* Clock.currentTimeMillis
    for (const trigger of triggers) {
      yield* triggerStore.register({
        id: trigger.id,
        workflow: trigger.launch.workflow._tag,
        schedule: store.scheduleKey(trigger.cron, trigger.timezone),
        enabled: trigger.enabled,
        at: startedAt
      })
    }

    const tick = (trigger: Trigger) =>
      Effect.gen(function*() {
        const now = yield* Clock.currentTimeMillis
        const held = yield* triggerStore.acquire(trigger.id, owner, now, options.leaseMs)
        if (Option.isNone(held)) return
        let row = held.value
        const write = (patch: store.Patch, rows: ReadonlyArray<Fire>) =>
          Effect.tap(triggerStore.update(trigger.id, owner, patch, rows), () =>
            Effect.sync(() => {
              row = {
                ...row,
                watermark: patch.watermark ?? row.watermark,
                active: patch.active === undefined ? row.active : patch.active ?? undefined,
                pending: patch.pending === undefined ? row.pending : patch.pending ?? undefined
              }
            }))

        // A claimed occurrence is a launch decided and not yet recorded as started.
        const launch = (occurrence: number, patch: store.Patch = {}) =>
          Effect.gen(function*() {
            yield* write({ ...patch, watermark: Math.max(row.watermark, occurrence) }, [fire(trigger, occurrence, "claimed", now)])
            const run = yield* runner.start({
              workflow: trigger.launch.workflow,
              payload: trigger.launch.payload,
              idempotencyKey: occurrenceKey(trigger, occurrence)
            })
            const newest = row.active === undefined || row.active.occurrence <= occurrence
            yield* write(newest ? { active: { run, occurrence } } : {}, [fire(trigger, occurrence, "launched", now, run)])
          })

        // Launches a dead host decided and did not record as started. The key joins any run it did start.
        const ledger = yield* triggerStore.fires(trigger.id)
        for (const claimed of ledger.filter((row) => row.outcome === "claimed").reverse()) {
          yield* launch(claimed.occurrence)
        }

        const running = Effect.gen(function*() {
          if (row.active === undefined) return false
          const state = yield* runner.inspect(trigger.launch.workflow, row.active.run)
          if (state === "active") return true
          yield* write({ active: null }, [])
          return false
        })

        if (!(yield* running) && row.pending !== undefined) {
          // The claim clears the buffer in the same write, so a crash keeps one or the other.
          yield* launch(row.pending, { pending: null })
        }

        if (!trigger.enabled) {
          // A disabled trigger owes nothing for the time it was disabled.
          yield* write({ watermark: Math.max(row.watermark, now) }, [])
          return
        }

        const { onTime, missed } = due(trigger, row.watermark, now, startedAt, trigger.maxCatchUp)
        const owed = missed.slice(0, trigger.maxCatchUp).reverse()
        const dropped = missed.slice(trigger.maxCatchUp)
        if (dropped.length > 0) {
          // One row stands for this occurrence and every earlier one the search did not count.
          yield* write({ watermark: Math.max(row.watermark, dropped[0]!) }, [
            fire(trigger, dropped[0]!, "missed", now, undefined, `This and earlier occurrences passed while no scheduler ran, beyond catchUp "${trigger.catchUp}" with maxCatchUp ${trigger.maxCatchUp}`)
          ])
        }

        for (const occurrence of [...owed, ...onTime]) {
          if (!(yield* running)) {
            yield* launch(occurrence)
            continue
          }
          const active = row.active!
          switch (trigger.overlap) {
            case "skip":
              yield* write({ watermark: occurrence }, [fire(trigger, occurrence, "skipped", now, undefined, `run ${active.run} was still going`)])
              break
            case "buffer-one": {
              const replaced = row.pending === undefined ? [] : [fire(trigger, row.pending, "skipped", now, undefined, "a newer occurrence took its buffer")]
              yield* write({ watermark: occurrence, pending: occurrence }, [...replaced, fire(trigger, occurrence, "buffered", now)])
              break
            }
            case "supersede":
              yield* runner.cancel(trigger.launch.workflow, active.run)
              yield* write({ active: null }, [fire(trigger, active.occurrence, "superseded", now, active.run, `cancelled for the occurrence at ${new Date(occurrence).toISOString()}`)])
              yield* launch(occurrence)
              break
          }
        }
      }).pipe(
        Effect.catchCause((cause) => Effect.logWarning(`Trigger ${trigger.id}: the scheduler will retry`, cause)),
        Effect.annotateLogs({ module: "Experimental.Trigger", trigger: trigger.id })
      )

    const nextWake = (now: number) => {
      let wake = now + options.pollMs
      for (const trigger of triggers) {
        if (trigger.enabled) wake = Math.min(wake, Cron.next(trigger.schedule, new Date(now)).getTime())
      }
      return wake
    }

    const loop = Effect.gen(function*() {
      for (const trigger of triggers) yield* tick(trigger)
      const now = yield* Clock.currentTimeMillis
      yield* Effect.sleep(Duration.millis(Math.max(0, nextWake(now) - now)))
    }).pipe(Effect.forever)

    yield* Effect.addFinalizer(() => Effect.forEach(triggers, (trigger) => triggerStore.release(trigger.id, owner), { discard: true }))
    yield* Effect.forkScoped(loop)
  })

/**
 * Registers the triggers in the {@link Store} and runs the scheduler for the
 * life of the layer's scope. Each element is a {@link Trigger} or the Effect
 * {@link cron} returns. Fails with {@link TriggerError} on a refused
 * declaration or two triggers with one id. Closing the scope stops the
 * scheduler and gives up its leases, so another host takes over at once.
 *
 * @category layers
 * @since 0.0.13
 */
export const layer = (
  triggers: ReadonlyArray<Trigger<any> | Effect.Effect<Trigger<any>, TriggerError>>,
  options: LayerOptions = {}
): Layer.Layer<never, TriggerError, Store | RunnerService> =>
  Layer.effectDiscard(Effect.gen(function*() {
    const pollMs = yield* positiveMillis(options.pollInterval, 60_000, "pollInterval")
    const leaseMs = yield* positiveMillis(options.lease, 5 * 60_000, "lease")
    if (leaseMs <= pollMs) return yield* refuse("invalid_options", "lease must be longer than pollInterval", "lease")
    const declared: Array<Trigger> = []
    const ids = new Set<string>()
    for (const entry of triggers) {
      const trigger: Trigger = Effect.isEffect(entry) ? yield* entry : entry
      if (ids.has(trigger.id)) return yield* refuse("invalid_options", `Two triggers have the id "${trigger.id}"`, "id")
      ids.add(trigger.id)
      declared.push(trigger)
    }
    yield* make(declared, { pollMs, leaseMs })
  }))

/**
 * A webhook request as `verify` sees it: the raw body, before anything has
 * parsed it, and the headers, with lowercase names.
 *
 * @category models
 * @since 0.0.13
 */
export interface Inbound {
  readonly body: Uint8Array
  readonly headers: Readonly<Record<string, string | undefined>>
}

/**
 * The options of {@link webhook}.
 *
 * @category models
 * @since 0.0.13
 */
export interface WebhookOptions<W extends Target> {
  /** The route, such as `"/hooks/deploy"`. The door answers `POST`. */
  readonly path: `/${string}`
  /**
   * Authenticates the request from its raw bytes and headers. It runs before
   * the body is parsed; any failure refuses the request with 401.
   */
  readonly verify: (request: Inbound) => Effect.Effect<void, unknown>
  /**
   * Maps the verified body, parsed as JSON, to `W`'s arguments or payload. A
   * body that is not JSON, a mapping that throws, or an input `W` refuses
   * answers 400.
   */
  readonly input: (body: unknown, request: Inbound) => Input<W>
}

/**
 * Where a verified request's signal goes: the run, the value, and the wait
 * point when the run waits on the signal at more than one.
 *
 * @category models
 * @since 0.0.13
 */
export interface Delivery<S extends Schema.Top> {
  readonly run: string
  readonly value: S["Type"]
  readonly point?: string | undefined
}

/**
 * The options of {@link webhook} for a door that sends a signal to a run of
 * `W` instead of starting one.
 *
 * @category models
 * @since 0.0.13
 */
export interface SignalWebhookOptions<S extends Schema.Top> {
  /** The route, such as `"/hooks/approve"`. The door answers `POST`. */
  readonly path: `/${string}`
  /**
   * Authenticates the request from its raw bytes and headers. It runs before
   * the body is parsed; any failure refuses the request with 401.
   */
  readonly verify: (request: Inbound) => Effect.Effect<void, unknown>
  /** The signal it delivers, declared with `Experimental.Durable.signal`. */
  readonly signal: Signal<string, S>
  /**
   * Maps the verified body, parsed as JSON, to the run and the value. A body
   * that is not JSON, a mapping that throws, or a value the signal's schema
   * refuses answers 400.
   */
  readonly deliver: (body: unknown, request: Inbound) => Delivery<S>
}

const respond = (status: number, body: Record<string, unknown>) => HttpServerResponse.jsonUnsafe(body, { status })

/**
 * A verified HTTP door that starts `W`: a `POST` route on Effect's
 * `HttpRouter`. `verify` receives the raw request bytes before anything is
 * parsed; only then is the body parsed and mapped by `input`. The run starts
 * through the {@link Runner}, keyed by the request's `Idempotency-Key`
 * header or else by the payload's VIP-44 identity, so a sender's retry joins
 * the run it started. Answers 202 with `{ run }`, 401 when `verify` fails,
 * 400 for a body or payload it refuses, and 503 when the runner fails. The
 * door grants nothing: the run has the services the runner gives every run.
 *
 * With {@link SignalWebhookOptions}, `signal` and `deliver` in place of
 * `input`, the door sends the signal to the run of `W` that `deliver` names,
 * through the runner's `send`, instead of starting one: 400 for a value the
 * signal's schema refuses, 404 for a run the runner does not know, 409 for a
 * finished run, 202 with `{ run }` once delivered, and 503 when the runner
 * cannot deliver.
 *
 * @category webhooks
 * @since 0.0.13
 */
export const webhook: {
  <W extends Target>(workflow: W, options: WebhookOptions<W>): Layer.Layer<never, never, HttpRouter.HttpRouter | RunnerService>
  <W extends Target, S extends Schema.Top>(workflow: W, options: SignalWebhookOptions<S>): Layer.Layer<never, never, HttpRouter.HttpRouter | RunnerService>
} = <W extends Target>(
  workflow: W,
  options: WebhookOptions<W> | SignalWebhookOptions<Schema.Top>
): Layer.Layer<never, never, HttpRouter.HttpRouter | RunnerService> =>
  Layer.unwrap(Effect.map(Effect.service(Runner), (runner) =>
    HttpRouter.add("POST", options.path, (request) =>
      Effect.gen(function*() {
        const raw = yield* Effect.option(request.arrayBuffer)
        if (Option.isNone(raw)) return respond(400, { error: "unreadable body" })
        const inbound: Inbound = {
          body: new Uint8Array(raw.value),
          headers: Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), value]))
        }
        // Verification sees its own copy of the bytes, before anything parses them.
        const verified = yield* Effect.exit(Effect.suspend(() => options.verify({ ...inbound, body: Uint8Array.from(inbound.body) })))
        if (verified._tag === "Failure") return respond(401, { error: "verification failed" })
        if ("signal" in options) return yield* deliverSignal(runner, workflow, options, inbound)
        // Parse, map and check the input; any failure answers 400.
        const accepted = yield* Effect.result(Effect.gen(function*() {
          const input = yield* Effect.try(() => (options as WebhookOptions<W>).input(JSON.parse(new TextDecoder().decode(inbound.body)), inbound))
          const resolved = yield* resolve(workflow, input)
          return { workflow: resolved.workflow, value: yield* Effect.try(() => resolved.workflow.payloadSchema.make(resolved.payload)) }
        }))
        if (Result.isFailure(accepted)) return respond(400, { error: `not an input of ${nameOf(workflow)}` })
        const target = accepted.success.workflow
        const key = inbound.headers["idempotency-key"] ?? `webhook:${options.path}:${canonical.identity(target.payloadSchema, accepted.success.value)}`
        const run = yield* Effect.exit(runner.start({ workflow: target, payload: accepted.success.value as object, idempotencyKey: key }))
        if (run._tag === "Failure") return respond(503, { error: "the run could not start" })
        return respond(202, { run: run.value })
      }))
  ))

// The signal half of a webhook: parse and map the verified body, check the
// value against the signal's schema, and deliver it to a run that waits.
const deliverSignal = (
  runner: RunnerService,
  target: Target,
  options: SignalWebhookOptions<Schema.Top>,
  inbound: Inbound
) =>
  Effect.gen(function*() {
    const accepted = yield* Effect.result(Effect.gen(function*() {
      const delivery = yield* Effect.try(() => options.deliver(JSON.parse(new TextDecoder().decode(inbound.body)), inbound))
      if (typeof delivery.run !== "string") return yield* Effect.fail("no run")
      yield* Schema.encodeUnknownEffect(options.signal.schema as Schema.Codec<unknown, unknown>)(delivery.value)
      return delivery
    }))
    if (Result.isFailure(accepted)) return respond(400, { error: `not a value of ${options.signal.name}` })
    const { run, value, point } = accepted.success
    const workflow = isDeclaredWorkflow(target) ? yield* engineWorkflow(target) : (target as AnyWorkflow)
    const state = yield* Effect.exit(runner.inspect(workflow, run))
    if (state._tag === "Failure") return respond(503, { error: "the run could not be read" })
    if (state.value === "missing") return respond(404, { error: `no run ${run} of ${nameOf(target)}` })
    if (state.value !== "active") return respond(409, { error: `run ${run} has finished` })
    const sent = yield* Effect.exit(runner.send({ workflow, run, signal: options.signal, value, point }))
    if (sent._tag === "Failure") return respond(503, { error: "the signal could not be delivered" })
    return respond(202, { run })
  })
