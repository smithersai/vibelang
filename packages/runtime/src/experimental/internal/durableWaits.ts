/**
 * Durable waits: a timer and a signal that park a run instead of holding a
 * fiber. Each is thin code over Effect's own `DurableClock` and
 * `DurableDeferred`, plus one recorded step per wait that journals why the
 * run waits, so a parked run says what it waits for.
 *
 * @internal
 */
import * as Clock from "effect/Clock"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { Activity, DurableClock, DurableDeferred, WorkflowEngine } from "effect/workflow"
// The public types live in Durable.ts, so a program's own declarations can
// name them through the package's exports.
import type { Signal, Waiting, WaitReason } from "../Durable.js"
import { StepInfo } from "./durableEngine.js"
import { encodeName, nextOccurrence } from "./durableSteps.js"
import { isTerminal, type JournalEntry, type RunRow } from "./durableStore.js"

/**
 * What a wait journals with its `StepStarted` event, under the key `wait`.
 * `closedBy` names what ends the wait: a durable deferred that is done, or a
 * recorded step that finished.
 */
export interface WaitRecord {
  readonly reason: WaitReason
  readonly name: string
  readonly closedBy: ReadonlyArray<string>
  readonly wakeAt?: number | undefined
  /** The durable deferred a delivery or an answer completes. The wait's token is its address in a run. */
  readonly deferred?: string | undefined
  readonly attempt?: number | undefined
  readonly request?: unknown
}

/**
 * Runs `execute` as one recorded step named `step`, whose `StepStarted`
 * event carries `record`. A replay serves the step's first result.
 */
export const announce = <Success extends Schema.Top>(
  step: string,
  record: WaitRecord,
  success: Success,
  execute: Effect.Effect<Success["Type"]>
): Effect.Effect<Success["Type"], never, WorkflowEngine.WorkflowEngine | WorkflowEngine.WorkflowInstance> =>
  Effect.provideService(
    Activity.make({ name: step, success, execute }) as unknown as Effect.Effect<
      Success["Type"],
      never,
      WorkflowEngine.WorkflowEngine | WorkflowEngine.WorkflowInstance
    >,
    StepInfo,
    { wait: record }
  )

/** The largest wake time a timer accepts: JavaScript's largest `Date`. */
const maxInstant = 8.64e15

/** A timer that was asked for a wake time no clock reaches. */
export class TimerInvalid extends Schema.TaggedError<TimerInvalid>()("TimerInvalid", {
  message: Schema.String
}) {}

const park = (
  label: string,
  name: string | undefined,
  compute: (now: number) => number
): Effect.Effect<void, never, WorkflowEngine.WorkflowEngine | WorkflowEngine.WorkflowInstance> =>
  Effect.gen(function*() {
    const instance = yield* WorkflowEngine.WorkflowInstance
    // Unnamed timers are numbered within the named race they run in.
    const key = name === undefined
      ? `Durable.sleep#${nextOccurrence(instance, "Durable.sleep", `${label} without a name`, ", or give the timer a name")}`
      : `Durable.sleep/${encodeName(name)}`
    const planned = compute(yield* Clock.currentTimeMillis)
    if (!Number.isFinite(planned) || Math.abs(planned) > maxInstant) {
      return yield* Effect.die(new TimerInvalid({ message: `${label} was asked to wake at ${planned}, which is not an instant` }))
    }
    // The wake time is this step's recorded result. A run that restarts
    // reads it back, so the delay never starts again.
    const wakeAt = yield* announce(
      key,
      { reason: "timer", name: key, wakeAt: planned, closedBy: [`DurableClock/${key}`, `${key}/elapsed`] },
      Schema.Number,
      Effect.succeed(planned)
    )
    const remaining = wakeAt - (yield* Clock.currentTimeMillis)
    if (remaining <= 0) {
      // Past due, and no clock recorded that it fired: the run was down when
      // the timer was due. One recorded step closes the wait.
      const fired = yield* (yield* WorkflowEngine.WorkflowEngine).deferredResult(DurableDeferred.make(`DurableClock/${key}`))
      if (Option.isNone(fired)) yield* Activity.make({ name: `${key}/elapsed`, execute: Effect.void })
      return
    }
    // No in-memory threshold: every timer parks the run.
    yield* DurableClock.sleep({ name: key, duration: Duration.millis(remaining), inMemoryThreshold: Duration.zero })
  })

export const sleep = (
  duration: Duration.Input,
  options?: { readonly name?: string | undefined }
): Effect.Effect<void, never, WorkflowEngine.WorkflowEngine | WorkflowEngine.WorkflowInstance> =>
  Effect.suspend(() => {
    const millis = Duration.toMillis(Duration.fromInputUnsafe(duration))
    return park("Durable.sleep", options?.name, (now) => now + Math.max(0, millis))
  })

export const until = (
  instant: Date | number,
  options?: { readonly name?: string | undefined }
): Effect.Effect<void, never, WorkflowEngine.WorkflowEngine | WorkflowEngine.WorkflowInstance> =>
  Effect.suspend(() => {
    const at = typeof instant === "number" ? instant : instant.getTime()
    return park("Durable.until", options?.name, () => at)
  })

/** The durable deferred of one wait point of a signal. */
export const signalDeferred = <S extends Schema.Top>(name: string, schema: S, point?: string) =>
  DurableDeferred.make(
    `Durable.signal/${encodeName(name)}${point === undefined ? "" : `#${encodeName(point)}`}`,
    { success: schema }
  )

export const signal = <const Name extends string, S extends Schema.Top>(name: Name, schema: S): Signal<Name, S> => ({
  name,
  schema,
  wait: (point) =>
    Effect.gen(function*() {
      const deferred = signalDeferred(name, schema, point)
      yield* announce(
        `${deferred.name}/wait`,
        { reason: "event", name: point === undefined ? name : `${name}#${point}`, deferred: deferred.name, closedBy: [deferred.name] },
        Schema.Void,
        Effect.void
      )
      return yield* DurableDeferred.await(deferred)
    }) as ReturnType<Signal<Name, S>["wait"]>,
  send: (W, run, value, point) =>
    Effect.gen(function*() {
      const deferred = signalDeferred(name, schema, point)
      yield* DurableDeferred.succeed(deferred, {
        token: DurableDeferred.tokenFromExecutionId(deferred, { workflow: W, executionId: run }),
        value
      })
      // An engine that has not loaded the run, such as one started after a
      // crash, loads it here, so the delivery wakes it.
      yield* (yield* WorkflowEngine.WorkflowEngine).resume(W, run)
    }) as ReturnType<Signal<Name, S>["send"]>
})

/**
 * The newest attempt of the question `name` in a journal, with the answer
 * recorded for it, if one is.
 */
export const lastAsked = (
  entries: ReadonlyArray<JournalEntry>,
  name: string
): { readonly attempt: number; readonly answer: unknown } | undefined => {
  let asked: { readonly attempt: number; readonly deferred: string } | undefined
  const done = new Map<string, unknown>()
  for (const entry of entries) {
    const payload = entry.payload as Record<string, unknown>
    if (entry.eventType === "StepStarted" && payload.wait !== undefined) {
      const record = payload.wait as WaitRecord
      if (record.reason === "approval" && record.name === name && record.attempt !== undefined && record.deferred !== undefined) {
        asked = { attempt: record.attempt, deferred: record.deferred }
      }
    } else if (entry.eventType === "DeferredDone" && !done.has(payload.name as string)) {
      done.set(payload.name as string, payload.exit)
    }
  }
  return asked === undefined ? undefined : { attempt: asked.attempt, answer: done.get(asked.deferred) }
}

/**
 * The waits a run is parked on, read from its journal: every recorded wait
 * that no delivery, answer or clock has closed. A finished run has none.
 */
export const openWaits = (row: RunRow, entries: ReadonlyArray<JournalEntry>): ReadonlyArray<Waiting> => {
  if (isTerminal(row.status)) return []
  const waits = new Map<string, { readonly record: WaitRecord; readonly seq: number; readonly at: number }>()
  const done = new Set<string>()
  let parkedOn: ReadonlyArray<string> | undefined
  for (const entry of entries) {
    const payload = entry.payload as Record<string, unknown>
    if (entry.eventType === "StepStarted" && payload.wait !== undefined) {
      waits.set(payload.step as string, { record: payload.wait as WaitRecord, seq: entry.seq, at: entry.at })
    } else if (entry.eventType === "DeferredDone") {
      done.add(payload.name as string)
    } else if (entry.eventType === "StepCompleted") {
      done.add(payload.step as string)
    } else if (entry.eventType === "RunSuspended") {
      parkedOn = Array.isArray(payload.waiting) ? payload.waiting as ReadonlyArray<string> : undefined
    } else if (entry.eventType === "RunRewound" || entry.eventType === "RunForked") {
      parkedOn = undefined
    }
  }
  const open: Array<Waiting> = []
  for (const { record, seq, at } of waits.values()) {
    if (record.closedBy.some((name) => done.has(name))) continue
    // An engine that journals what a suspension awaited narrows the list to
    // it, which drops the losing branch of a race.
    if (parkedOn !== undefined && !record.closedBy.some((name) => parkedOn!.includes(name))) continue
    open.push({
      reason: record.reason,
      name: record.name,
      seq,
      since: at,
      ...(record.wakeAt === undefined ? {} : { wakeAt: record.wakeAt }),
      // The address is built from the run that holds the journal, so a
      // fork's waits address the fork.
      ...(record.deferred === undefined ? {} : {
        token: new DurableDeferred.TokenParsed({ workflowName: row.workflow, executionId: row.run, deferredName: record.deferred }).asToken
      }),
      ...(record.attempt === undefined ? {} : { attempt: record.attempt }),
      ...(record.request === undefined ? {} : { request: record.request })
    })
  }
  return open.sort((a, b) => a.seq - b.seq)
}
