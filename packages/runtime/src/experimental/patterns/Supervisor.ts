/**
 * A supervisor: one boss plans, workers execute in parallel, the boss
 * reviews, and only the tasks the review calls retriable are delegated again.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Effect from "effect/Effect"
import { escalated, ownTrue, stallPolicy } from "./internal.js"
import { PatternError } from "./PatternError.js"
import * as Stall from "./Stall.js"

/**
 * One unit of delegated work. `workerType` says which kind of worker performs
 * it; `id` is what a review names to delegate it again.
 *
 * @category models
 * @since 0.0.13
 */
export interface Task {
  readonly id: string
  readonly workerType: string
}

/**
 * A plan the supervisor delegates from.
 *
 * @category models
 * @since 0.0.13
 */
export interface Plan {
  readonly tasks: ReadonlyArray<Task>
}

/**
 * The result of one worker attempt. A worker's failure is kept as a `Failed`
 * outcome, so the review sees every task and decides what to delegate again.
 *
 * @category models
 * @since 0.0.13
 */
export type Outcome<Out> =
  | {
    readonly _tag: "Done"
    readonly id: string
    readonly workerType: string
    readonly round: number
    readonly output: Out
  }
  | {
    readonly _tag: "Failed"
    readonly id: string
    readonly workerType: string
    readonly round: number
    readonly error: unknown
  }

/**
 * A stall breaker for the supervision. `signals` reads what to compare from
 * each round's results; without it every task's latest outcome is compared,
 * without the round it ran in.
 *
 * @category models
 * @since 0.0.13
 */
export interface StallOptions<A> extends Stall.Options {
  readonly signals?: ((results: A) => Stall.Observation) | undefined
}

/**
 * The stages of {@link run}. `worker` runs once for each pending task in a
 * round; from round 2 on it also receives the `review` that delegated the
 * task again and the `retriable` ids that review named. `maxTasks` is the
 * most tasks the plan may name.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options<I, P extends Plan, Out, Review, Final, E, R, E2, R2, E3, R3, E4, R4> {
  readonly plan: (input: I) => Effect.Effect<P, E, R>
  readonly worker: (args: {
    readonly task: Task
    readonly plan: P
    readonly round: number
    readonly input: I
    readonly review?: Review | undefined
    readonly retriable?: ReadonlyArray<string> | undefined
  }) => Effect.Effect<Out, E2, R2>
  readonly review: (args: {
    readonly plan: P
    readonly results: ReadonlyArray<Outcome<Out>>
    readonly round: number
    readonly input: I
  }) => Effect.Effect<Review, E3, R3>
  readonly finalize: (args: {
    readonly plan: P
    readonly results: ReadonlyArray<Outcome<Out>>
    readonly review: Review
    readonly rounds: number
    readonly input: I
  }) => Effect.Effect<Final, E4, R4>
  readonly maxRounds: number
  readonly maxTasks: number
  readonly concurrency: number
  readonly stall?: StallOptions<ReadonlyArray<Outcome<Out>>> | undefined
}

/**
 * A review accepted the work and `finalize` ran.
 *
 * @category models
 * @since 0.0.13
 */
export interface Completed<Final> {
  readonly exhausted: false
  readonly rounds: number
  readonly final: Final
}

/**
 * The rounds ran out, the last review named nothing to delegate again, or the
 * stall breaker ended the supervision (`stalled` is set). `finalize` did not
 * run.
 *
 * @category models
 * @since 0.0.13
 */
export interface Exhausted<Review> {
  readonly exhausted: true
  readonly rounds: number
  readonly review: Review
  readonly stalled?: Stall.Stalled | undefined
}

// Own properties only: an inherited `allDone` or `retriable` is not the
// review's verdict.
const done = (value: unknown): boolean => value === true || ownTrue(value, "allDone")

const retriable = (value: unknown): ReadonlyArray<string> => {
  if (typeof value !== "object" || value === null || !Object.hasOwn(value, "retriable")) return []
  const ids = (value as { readonly retriable: unknown }).retriable
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []
}

// A round's default stall signal: every task's latest outcome without its
// round, and an `Error` failure by its name and message, which has a
// canonical form where the instance has none.
const unrounded = (results: ReadonlyArray<Outcome<unknown>>): unknown =>
  results.map((outcome) => {
    if (outcome._tag === "Done") {
      return { _tag: "Done", id: outcome.id, workerType: outcome.workerType, output: outcome.output }
    }
    const error = outcome.error instanceof Error ? `${outcome.error.name}: ${outcome.error.message}` : outcome.error
    return { _tag: "Failed", id: outcome.id, workerType: outcome.workerType, error }
  })

const bound = (value: number): boolean => Number.isSafeInteger(value) && value >= 1

const invalid = (message: string): PatternError => new PatternError({ code: "invalid_input", message })

// The plan is model output, so a malformed one is an input fault. The length
// is checked before any task is read: every task costs a worker call a round.
const validateTasks = (plan: unknown, maxTasks: number): ReadonlyArray<Task> | PatternError => {
  if (typeof plan !== "object" || plan === null || !Object.hasOwn(plan, "tasks")) {
    return invalid("Supervisor input must contain a tasks array")
  }
  const tasks = (plan as { readonly tasks: unknown }).tasks
  if (!Array.isArray(tasks)) return invalid("Supervisor input must contain a tasks array")
  if (tasks.length === 0) return invalid("Supervisor input must contain at least one task")
  if (tasks.length > maxTasks) {
    return invalid(`Supervisor plan names ${tasks.length} tasks, more than maxTasks ${maxTasks}`)
  }
  const snapshot: Array<Task> = []
  for (const task of tasks) {
    const candidate = task as { readonly id?: unknown; readonly workerType?: unknown }
    if (
      typeof task !== "object" || task === null ||
      typeof candidate.id !== "string" || typeof candidate.workerType !== "string"
    ) {
      return invalid("Supervisor tasks must each carry a string id and a string workerType")
    }
    snapshot.push({ id: candidate.id, workerType: candidate.workerType })
  }
  return snapshot
}

/**
 * Plans once, then each round runs the pending tasks' workers at most
 * `concurrency` at a time, has the boss review every task's latest outcome,
 * and either finalizes or delegates the tasks the review named retriable.
 * A review accepts with `true` or an own `allDone: true`, and names tasks to
 * delegate again in an own `retriable` array of ids. A worker's failure is a
 * `Failed` outcome; a worker defect fails the supervision.
 *
 * Fails with `PatternError`: `invalid_decorator` when a bound is not a
 * positive safe integer or the stall `rounds` is not a safe integer of at
 * least 2; `invalid_input` when the plan has no `tasks` array, is empty,
 * names more than `maxTasks` tasks, has a task without a string `id` and
 * `workerType`, or repeats an id, all before any worker runs; `stalled` when
 * a breaker with `on: "escalate"` trips.
 *
 * @category combinators
 * @since 0.0.13
 */
export const run = <I, P extends Plan, Out, Review, Final, E, R, E2, R2, E3, R3, E4, R4>(
  input: I,
  options: Options<I, P, Out, Review, Final, E, R, E2, R2, E3, R3, E4, R4>
): Effect.Effect<Completed<Final> | Exhausted<Review>, E | E3 | E4 | PatternError, R | R2 | R3 | R4> => {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the options in between must not reach it.
  const boss = { plan: options.plan, review: options.review, finalize: options.finalize }
  const worker = options.worker
  const maxRounds = options.maxRounds
  const maxTasks = options.maxTasks
  const concurrency = options.concurrency
  if (!bound(maxRounds) || !bound(maxTasks) || !bound(concurrency)) {
    return Effect.fail(
      new PatternError({
        code: "invalid_decorator",
        message: "Supervisor maxRounds, maxTasks and concurrency must be positive safe integers"
      })
    )
  }
  const stall = stallPolicy("Supervisor", options.stall)
  if (stall instanceof PatternError) return Effect.fail(stall)
  const signals = options.stall?.signals ??
    ((results: ReadonlyArray<Outcome<Out>>): Stall.Observation => ({ output: unrounded(results) }))
  return Effect.gen(function*() {
    let streaks = Stall.initial
    const plan = yield* boss.plan(input)
    const tasks = validateTasks(plan, maxTasks)
    if (tasks instanceof PatternError) return yield* Effect.fail(tasks)
    const ids = tasks.map((task) => task.id)
    if (new Set(ids).size !== ids.length) return yield* Effect.fail(invalid("Supervisor task ids must be unique"))
    const latest = new Map<string, Outcome<Out>>()
    let pending = tasks
    let previous: { readonly review: Review; readonly retriable: ReadonlyArray<string> } | undefined
    let round = 1
    while (true) {
      const settledRound = round
      const sentBack = previous
      const outcomes = yield* Effect.forEach(
        pending,
        (task) =>
          // A worker delegated again sees the review that sent it back.
          worker(
            sentBack === undefined
              ? { task, plan, round: settledRound, input }
              : { task, plan, round: settledRound, input, ...sentBack }
          ).pipe(
            Effect.map((output): Outcome<Out> => ({
              _tag: "Done",
              id: task.id,
              workerType: task.workerType,
              round: settledRound,
              output
            })),
            Effect.catch((error): Effect.Effect<Outcome<Out>> =>
              Effect.succeed({ _tag: "Failed", id: task.id, workerType: task.workerType, round: settledRound, error })
            )
          ),
        { concurrency }
      )
      for (const outcome of outcomes) latest.set(outcome.id, outcome)
      // Round one runs every task and later rounds only replace entries, so
      // every task has an outcome here.
      const results = tasks.map((task) => latest.get(task.id)!)
      const review = yield* boss.review({ plan, results, round, input })
      if (done(review)) {
        const final = yield* boss.finalize({ plan, results, review, rounds: round, input })
        const completed: Completed<Final> = { exhausted: false, rounds: round, final }
        return completed
      }
      if (round === maxRounds) {
        const spent: Exhausted<Review> = { exhausted: true, rounds: round, review }
        return spent
      }
      if (stall !== undefined) {
        const observed = Stall.observe(stall, streaks, signals(results))
        streaks = observed.state
        const stalled = observed.stalled
        if (stalled !== undefined) {
          if (stalled.on === "escalate") return yield* Effect.fail(escalated("Supervisor", stalled.rounds))
          const parked: Exhausted<Review> = { exhausted: true, rounds: round, review, stalled }
          return parked
        }
      }
      const named = retriable(review)
      pending = tasks.filter((task) => named.includes(task.id))
      if (pending.length === 0) {
        const settled: Exhausted<Review> = { exhausted: true, rounds: round, review }
        return settled
      }
      previous = { review, retriable: named }
      round += 1
    }
  })
}
