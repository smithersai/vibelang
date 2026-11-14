/**
 * A saga: forward steps whose compensations unwind in reverse when a later
 * step fails or the run is interrupted.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import { PatternError } from "./PatternError.js"

/**
 * What a step failure does to the steps that already completed.
 * `compensate` (the default) unwinds them and settles `Compensated`;
 * `compensate-and-fail` unwinds them and fails with the step's failure;
 * `fail` leaves them alone and fails.
 *
 * @category models
 * @since 0.0.13
 */
export type OnFailure = "compensate" | "compensate-and-fail" | "fail"

/**
 * One step: the action that changes the world and the compensation that
 * undoes it. The action receives `{ input, completed }`, the values of the
 * steps before it keyed by id; the compensation receives
 * `{ id, input, value }`, where `value` is what its own action returned.
 *
 * @category models
 * @since 0.0.13
 */
export interface RuntimeStep<I, A, E, R, E2, R2> {
  readonly id: string
  readonly action: (input: { readonly input: I; readonly completed: Readonly<Record<string, A>> }) => Effect.Effect<A, E, R>
  readonly compensation: (input: { readonly id: string; readonly input: I; readonly value: A }) => Effect.Effect<unknown, E2, R2>
}

/**
 * The options of {@link run}.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options<I, A, E, R, E2, R2> {
  readonly steps: ReadonlyArray<RuntimeStep<I, A, E, R, E2, R2>>
  readonly onFailure?: OnFailure | undefined
}

/**
 * Every step ran. The values are nested under `values`, so a step id can
 * never forge the other arm.
 *
 * @category models
 * @since 0.0.13
 */
export interface Completed<A> {
  readonly _tag: "Completed"
  readonly values: Readonly<Record<string, A>>
}

/**
 * A step failed and every completed step was undone, under `compensate`.
 *
 * @category models
 * @since 0.0.13
 */
export interface Compensated<E> {
  readonly _tag: "Compensated"
  readonly failure: E
}

/**
 * How a saga ends.
 *
 * @category models
 * @since 0.0.13
 */
export type Settled<A, E> = Completed<A> | Compensated<E>

const stepsRefusal = (steps: ReadonlyArray<{ readonly id: string }>): PatternError | undefined => {
  if (steps.length === 0) {
    return new PatternError({ code: "invalid_decorator", message: "Saga requires at least one step" })
  }
  if (new Set(steps.map((step) => step.id)).size !== steps.length) {
    return new PatternError({ code: "invalid_decorator", message: "Saga step ids must be unique" })
  }
  return undefined
}

/**
 * Runs the steps in order. When a step fails, or the run is interrupted,
 * the completed steps' compensations run in reverse order (unless the
 * policy is `fail`).
 *
 * A compensation that fails or dies does not stop the ones behind it. When
 * any did, the run fails with `PatternError` (`compensation_failed`) naming
 * those steps in sorted order, with `cause` holding the step `failure` and
 * each `residue` entry `{ id, error }`: state left dirty outranks the
 * failure that started the unwind. A defect in a step is not compensated
 * away: it fails the run after the unwind.
 *
 * Fails with `PatternError` (`invalid_decorator`) before any step runs when
 * there is no step or two steps share an id.
 *
 * @category combinators
 * @since 0.0.13
 */
export const run = <I, A, E, R, E2, R2>(
  input: I,
  options: Options<I, A, E, R, E2, R2>
): Effect.Effect<Settled<A, E>, E | PatternError, R | R2> => {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the array, a step, or the options in between must not reach it.
  const steps = options.steps.map((step) => ({ id: step.id, action: step.action, compensation: step.compensation }))
  const policy = options.onFailure ?? "compensate"
  return Effect.suspend(() => {
    const refusal = stepsRefusal(steps)
    if (refusal !== undefined) return Effect.fail(refusal)
    const residue: Array<{ readonly id: string; readonly error: unknown }> = []
    const forward = Effect.gen(function*() {
      const completed = new Map<string, A>()
      for (const step of steps) {
        const value = yield* step.action({ input, completed: Object.fromEntries(completed) })
        completed.set(step.id, value)
        if (policy === "fail") continue
        // A scope finalizer per completed step: the unwind is last in, first
        // out, and it runs on interruption as well as on failure.
        yield* Effect.addFinalizer((exit) =>
          Exit.isSuccess(exit)
            ? Effect.void
            : Effect.matchCause(Effect.suspend(() => step.compensation({ id: step.id, input, value })), {
              onFailure: (cause) => {
                residue.push({ id: step.id, error: Cause.squash(cause) })
              },
              onSuccess: () => {}
            })
        )
      }
      return Object.fromEntries(completed)
    })
    const settle = (exit: Exit.Exit<Readonly<Record<string, A>>, E>): Effect.Effect<Settled<A, E>, E | PatternError> => {
      const failure = Exit.findErrorOption(exit)
      if (residue.length > 0) {
        const sorted = [...residue].sort((left, right) => left.id.localeCompare(right.id))
        return Effect.fail(
          new PatternError({
            code: "compensation_failed",
            message: `Saga compensation failed for: ${sorted.map((entry) => entry.id).join(", ")}`,
            cause: { ...(Option.isSome(failure) ? { failure: failure.value } : {}), residue: sorted }
          })
        )
      }
      if (!Exit.isSuccess(exit) && policy === "compensate" && Option.isSome(failure)) {
        return Effect.succeed<Settled<A, E>>({ _tag: "Compensated", failure: failure.value })
      }
      return Effect.map(exit, (values): Settled<A, E> => ({ _tag: "Completed", values }))
    }
    return Effect.flatMap(Effect.exit(Effect.scoped(forward)), settle)
  })
}
