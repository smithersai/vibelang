/**
 * The black-box engine conformance cases behind
 * `Experimental.Test.conformance.engine()`: identity, interruption, replay
 * and race, observed only through Effect's `WorkflowEngine` API, each
 * activity's invocation count and each run's result.
 *
 * @internal
 */
import * as Cause from "effect/Cause"
import type * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import { Activity, DurableDeferred, Workflow, WorkflowEngine } from "effect/workflow"

/**
 * A conformance case that does not hold for an engine.
 */
export class ConformanceViolation extends Data.TaggedError("ConformanceViolation")<{
  readonly case: string
  readonly message: string
  readonly expected?: unknown
  readonly actual?: unknown
}> {}

/**
 * An engine under test. Running it allocates fresh storage and returns the
 * engine's layer over that storage; each build of the layer is one engine
 * process, so a case stops a process by closing its scope and starts
 * another over the same storage.
 */
export type EngineSubject = Effect.Effect<Layer.Layer<WorkflowEngine.WorkflowEngine>>

/** One black-box case. */
export interface ConformanceCase {
  readonly name: string
  readonly run: (engine: EngineSubject) => Effect.Effect<void, ConformanceViolation>
}

interface Process {
  readonly context: Context.Context<WorkflowEngine.WorkflowEngine>
  readonly kill: Effect.Effect<void>
}

// One engine process with the case's workflows registered on it.
const boot = (engine: Layer.Layer<WorkflowEngine.WorkflowEngine>, workflows: Layer.Layer<never, never, WorkflowEngine.WorkflowEngine>) =>
  Effect.gen(function*() {
    const scope = yield* Scope.make()
    const context = yield* Layer.buildWithScope(Layer.provideMerge(workflows, engine), scope)
    return { context, kill: Scope.close(scope, Exit.void) } satisfies Process
  })

const within = <A, E>(process: Process, effect: Effect.Effect<A, E, WorkflowEngine.WorkflowEngine>) =>
  Effect.provideContext(effect, process.context)

class Counter {
  value = 0
  readonly bump = Effect.sync(() => void this.value++)
}

const violation = (name: string, message: string, expected?: unknown, actual?: unknown) =>
  Effect.fail(new ConformanceViolation({ case: name, message, expected, actual }))

const check = (name: string, holds: boolean, message: string, expected?: unknown, actual?: unknown) =>
  holds ? Effect.void : violation(name, message, expected, actual)

// A case's own failure or a defect in the engine both become a violation
// naming the case, so a runner can report every case of a suite.
const guard = (name: string, body: Effect.Effect<void, ConformanceViolation | unknown>) =>
  Effect.scoped(body as Effect.Effect<void, unknown, Scope.Scope>).pipe(
    Effect.catchCause((cause) => {
      const failure = Cause.findErrorOption(cause)
      if (Option.isSome(failure) && failure.value instanceof ConformanceViolation) return Effect.fail(failure.value)
      return violation(name, `the engine failed: ${Cause.pretty(cause)}`)
    })
  )

// Polls a run until `done` holds, yielding between polls. No clock is read,
// so the cases run under TestClock.
const pollUntil = <A>(
  name: string,
  process: Process,
  poll: Effect.Effect<A, never, WorkflowEngine.WorkflowEngine>,
  done: (value: A) => boolean,
  what: string
) =>
  Effect.gen(function*() {
    for (let i = 0; i < 20_000; i++) {
      const value = yield* within(process, poll)
      if (done(value)) return value
      yield* Effect.yieldNow
    }
    return yield* violation(name, `the run never became ${what}`)
  })

const isSuspended = (result: Option.Option<Workflow.Result<unknown, unknown>>) =>
  Option.isSome(result) && result.value._tag === "Suspended"

const isComplete = (result: Option.Option<Workflow.Result<unknown, unknown>>) =>
  Option.isSome(result) && result.value._tag === "Complete"

const payload = { n: Schema.Number }

const identityDistinct: ConformanceCase = {
  name: "identity/distinct",
  run: (subject) =>
    guard("identity/distinct", Effect.gen(function*() {
      const name = "identity/distinct"
      const invoked = new Counter()
      const W = Workflow.make(`conformance/${name}`, { payload, success: Schema.Number, idempotencyKey: ({ n }) => String(n) })
      const Double = (n: number) =>
        Activity.make({ name: "double", success: Schema.Number, execute: Effect.as(invoked.bump, n * 2) })
      const process = yield* boot(yield* subject, W.toLayer(({ n }) => Double(n)))
      const first = yield* within(process, W.execute({ n: 1 }))
      const second = yield* within(process, W.execute({ n: 2 }))
      const ids = [yield* W.executionId({ n: 1 }), yield* W.executionId({ n: 2 })]
      yield* check(name, ids[0] !== ids[1], "different payloads must name different runs", "two ids", ids)
      yield* check(name, first === 2 && second === 4, "each run must return its own result", [2, 4], [first, second])
      yield* check(name, invoked.value === 2, "each run must invoke its activity", 2, invoked.value)
    }))
}

const identityIdempotent: ConformanceCase = {
  name: "identity/idempotent",
  run: (subject) =>
    guard("identity/idempotent", Effect.gen(function*() {
      const name = "identity/idempotent"
      const invoked = new Counter()
      const W = Workflow.make(`conformance/${name}`, { payload, success: Schema.Number, idempotencyKey: ({ n }) => String(n) })
      const process = yield* boot(
        yield* subject,
        W.toLayer(({ n }) => Activity.make({ name: "once", success: Schema.Number, execute: Effect.as(invoked.bump, n + 1) }))
      )
      const first = yield* within(process, W.execute({ n: 1 }))
      const second = yield* within(process, W.execute({ n: 1 }))
      yield* check(name, first === 2 && second === 2, "an equal payload must return the run's result", [2, 2], [first, second])
      yield* check(name, invoked.value === 1, "an equal payload must join the run, not start another", 1, invoked.value)
    }))
}

const identityActivityName: ConformanceCase = {
  name: "identity/activity-name",
  run: (subject) =>
    guard("identity/activity-name", Effect.gen(function*() {
      const name = "identity/activity-name"
      const first = new Counter()
      const second = new Counter()
      const W = Workflow.make(`conformance/${name}`, { payload, success: Schema.Array(Schema.String), idempotencyKey: ({ n }) => String(n) })
      const process = yield* boot(
        yield* subject,
        W.toLayer(() =>
          Effect.all([
            Activity.make({ name: "same", success: Schema.String, execute: Effect.as(first.bump, "first") }),
            Activity.make({ name: "same", success: Schema.String, execute: Effect.as(second.bump, "second") })
          ])
        )
      )
      const result = yield* within(process, W.execute({ n: 1 }))
      yield* check(
        name,
        result[0] === "first" && result[1] === "first" && first.value === 1 && second.value === 0,
        "an activity is identified by its name in a run: a second activity of that name returns the recorded result",
        { result: ["first", "first"], invoked: [1, 0] },
        { result, invoked: [first.value, second.value] }
      )
    }))
}

const interruptInFlight: ConformanceCase = {
  name: "interrupt/in-flight",
  run: (subject) =>
    guard("interrupt/in-flight", Effect.gen(function*() {
      const name = "interrupt/in-flight"
      const started = yield* Deferred.make<void>()
      const interrupted = new Counter()
      const after = new Counter()
      const W = Workflow.make(`conformance/${name}`, { payload, success: Schema.Number, idempotencyKey: ({ n }) => String(n) })
      const process = yield* boot(
        yield* subject,
        W.toLayer(() =>
          Effect.andThen(
            Activity.make({
              name: "long",
              success: Schema.Void,
              execute: Effect.andThen(Deferred.succeed(started, void 0), Effect.never).pipe(Effect.onInterrupt(() => interrupted.bump))
            }),
            Activity.make({ name: "after", success: Schema.Number, execute: Effect.as(after.bump, 1) })
          )
        )
      )
      const id = yield* within(process, W.execute({ n: 1 }, { discard: true }))
      yield* Deferred.await(started)
      // A safe interrupt (W.interrupt) waits until the run would suspend; an
      // in-flight abort is the engine's interruptUnsafe.
      yield* within(process, Effect.gen(function*() {
        const engine = yield* WorkflowEngine.WorkflowEngine
        yield* engine.interruptUnsafe(W, id)
      }))
      const result = yield* pollUntil(name, process, W.poll(id), isComplete, "complete after its interruption")
      const exit = Option.isSome(result) && result.value._tag === "Complete" ? result.value.exit : undefined
      yield* check(
        name,
        exit !== undefined && Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause),
        "an interrupted run must end interrupted",
        "an interrupt-only failure",
        exit
      )
      yield* check(name, interrupted.value === 1, "the activity in flight must be interrupted", 1, interrupted.value)
      yield* check(name, after.value === 0, "no activity may run after the interruption", 0, after.value)
    }))
}

const replayCompletedPrefix: ConformanceCase = {
  name: "replay/completed-prefix",
  run: (subject) =>
    guard("replay/completed-prefix", Effect.gen(function*() {
      const name = "replay/completed-prefix"
      const prefix = new Counter()
      const frontier = new Counter()
      const reached = yield* Deferred.make<void>()
      const W = Workflow.make(`conformance/${name}`, { payload, success: Schema.Number, idempotencyKey: ({ n }) => String(n) })
      // The frontier hangs on its first invocation, as a step does when its
      // process dies, and finishes on its second.
      const workflows = W.toLayer(({ n }) =>
        Effect.gen(function*() {
          const a = yield* Activity.make({ name: "prefix", success: Schema.Number, execute: Effect.as(prefix.bump, n) })
          return yield* Activity.make({
            name: "frontier",
            success: Schema.Number,
            execute: Effect.andThen(
              frontier.bump,
              Effect.suspend(() => (frontier.value === 1 ? Effect.andThen(Deferred.succeed(reached, void 0), Effect.never) : Effect.succeed(a + 1)))
            )
          })
        })
      )
      const storage = yield* subject
      const first = yield* boot(storage, workflows)
      yield* within(first, W.execute({ n: 1 }, { discard: true }))
      yield* Deferred.await(reached)
      yield* first.kill
      const second = yield* boot(storage, workflows)
      const result = yield* within(second, W.execute({ n: 1 }))
      yield* check(name, result === 2, "the resumed run must finish with its result", 2, result)
      yield* check(name, prefix.value === 1, "a finished activity must not run again after a restart", 1, prefix.value)
      yield* check(name, frontier.value === 2, "the unfinished activity must run again after a restart", 2, frontier.value)
    }))
}

const replaySuspendedFrontier: ConformanceCase = {
  name: "replay/suspended-frontier",
  run: (subject) =>
    guard("replay/suspended-frontier", Effect.gen(function*() {
      const name = "replay/suspended-frontier"
      const prefix = new Counter()
      const after = new Counter()
      const Approval = DurableDeferred.make("approval", { success: Schema.String })
      const W = Workflow.make(`conformance/${name}`, { payload, success: Schema.String, idempotencyKey: ({ n }) => String(n) })
      const workflows = W.toLayer(({ n }) =>
        Effect.gen(function*() {
          yield* Activity.make({ name: "prefix", success: Schema.Number, execute: Effect.as(prefix.bump, n) })
          const answer = yield* DurableDeferred.await(Approval)
          return yield* Activity.make({ name: "after", success: Schema.String, execute: Effect.as(after.bump, `approved:${answer}`) })
        })
      )
      const storage = yield* subject
      const first = yield* boot(storage, workflows)
      const id = yield* within(first, W.execute({ n: 1 }, { discard: true }))
      yield* pollUntil(name, first, W.poll(id), isSuspended, "suspended at its deferred")
      yield* first.kill
      const second = yield* boot(storage, workflows)
      const token = DurableDeferred.tokenFromExecutionId(Approval, { workflow: W, executionId: id })
      yield* within(second, DurableDeferred.succeed(Approval, { token, value: "yes" }))
      yield* within(second, W.resume(id))
      const result = yield* pollUntil(name, second, W.poll(id), isComplete, "complete after its deferred was done")
      const exit = Option.isSome(result) && result.value._tag === "Complete" ? result.value.exit : undefined
      yield* check(
        name,
        exit !== undefined && Exit.isSuccess(exit) && exit.value === "approved:yes",
        "the run must resume at its frontier and finish",
        "approved:yes",
        exit
      )
      yield* check(name, prefix.value === 1, "the prefix before the suspension must not run again", 1, prefix.value)
      yield* check(name, after.value === 1, "the step after the frontier must run once", 1, after.value)
    }))
}

interface RaceObservation {
  readonly result: Exit.Exit<unknown, unknown> | undefined
  readonly winnerRuns: number
  readonly loserRuns: number
  readonly loserInterruptions: number
}

// Races a fast winner against a loser that waits, parks the run on a
// deferred after the race, restarts the engine, and resumes the run with the
// timing inverted: were the race run again, the loser would win.
const runRace = (name: string, subject: EngineSubject, restart: boolean) =>
  Effect.gen(function*() {
    const winnerRuns = new Counter()
    const loserRuns = new Counter()
    const loserInterruptions = new Counter()
    const inverted = { value: false }
    const loserStarted = yield* Deferred.make<void>()
    const Parked = DurableDeferred.make("parked", { success: Schema.String })
    const W = Workflow.make(`conformance/${name}`, { payload, success: Schema.String, idempotencyKey: ({ n }) => String(n) })
    const workflows = W.toLayer(() =>
      Effect.gen(function*() {
        const winner = yield* Activity.raceAll("race", [
          Activity.make({
            name: "winner",
            success: Schema.String,
            execute: Effect.andThen(
              winnerRuns.bump,
              Effect.suspend(() => (inverted.value ? Effect.never : Effect.andThen(Deferred.await(loserStarted), Effect.succeed("winner"))))
            )
          }),
          Activity.make({
            name: "loser",
            success: Schema.String,
            execute: Effect.andThen(
              loserRuns.bump,
              Effect.suspend(() =>
                inverted.value ? Effect.succeed("loser") : Effect.andThen(Deferred.succeed(loserStarted, void 0), Effect.never)
              )
            ).pipe(Effect.onInterrupt(() => loserInterruptions.bump))
          })
        ])
        yield* DurableDeferred.await(Parked)
        return winner
      })
    )
    const storage = yield* subject
    const first = yield* boot(storage, workflows)
    const id = yield* within(first, W.execute({ n: 1 }, { discard: true }))
    yield* pollUntil(name, first, W.poll(id), isSuspended, "suspended after its race")
    if (!restart) {
      return {
        result: undefined,
        winnerRuns: winnerRuns.value,
        loserRuns: loserRuns.value,
        loserInterruptions: loserInterruptions.value
      } satisfies RaceObservation
    }
    yield* first.kill
    inverted.value = true
    const second = yield* boot(storage, workflows)
    const token = DurableDeferred.tokenFromExecutionId(Parked, { workflow: W, executionId: id })
    yield* within(second, DurableDeferred.succeed(Parked, { token, value: "go" }))
    yield* within(second, W.resume(id))
    const done = yield* pollUntil(name, second, W.poll(id), isComplete, "complete after it was resumed")
    return {
      result: Option.isSome(done) && done.value._tag === "Complete" ? done.value.exit : undefined,
      winnerRuns: winnerRuns.value,
      loserRuns: loserRuns.value,
      loserInterruptions: loserInterruptions.value
    } satisfies RaceObservation
  })

const raceLoserInterrupted: ConformanceCase = {
  name: "race/loser-interrupted",
  run: (subject) =>
    guard("race/loser-interrupted", Effect.gen(function*() {
      const name = "race/loser-interrupted"
      const seen = yield* runRace(name, subject, false)
      yield* check(name, seen.loserInterruptions === 1, "the losing activity must be interrupted once the winner finishes", 1, seen.loserInterruptions)
    }))
}

const raceRecordedWinner: ConformanceCase = {
  name: "race/recorded-winner",
  run: (subject) =>
    guard("race/recorded-winner", Effect.gen(function*() {
      const name = "race/recorded-winner"
      const seen = yield* runRace(name, subject, true)
      yield* check(
        name,
        seen.result !== undefined && Exit.isSuccess(seen.result) && seen.result.value === "winner",
        "a resumed run must take the race's recorded winner, not race again",
        "winner",
        seen.result
      )
      yield* check(name, seen.winnerRuns === 1, "the recorded winner must not run again", 1, seen.winnerRuns)
    }))
}

const raceRecordedLoser: ConformanceCase = {
  name: "race/recorded-loser",
  run: (subject) =>
    guard("race/recorded-loser", Effect.gen(function*() {
      const name = "race/recorded-loser"
      const seen = yield* runRace(name, subject, true)
      yield* check(
        name,
        seen.loserRuns === 1 && seen.loserInterruptions === 1,
        "the recorded loser must stay lost: it is not run again when the run resumes",
        { loserRuns: 1, loserInterruptions: 1 },
        { loserRuns: seen.loserRuns, loserInterruptions: seen.loserInterruptions }
      )
    }))
}

/** The nine cases, in a fixed order. */
export const engineCases: ReadonlyArray<ConformanceCase> = Object.freeze([
  identityDistinct,
  identityIdempotent,
  identityActivityName,
  interruptInFlight,
  replayCompletedPrefix,
  replaySuspendedFrontier,
  raceLoserInterrupted,
  raceRecordedWinner,
  raceRecordedLoser
].map((conformanceCase) => Object.freeze({ ...conformanceCase })))
