/**
 * A sidecar: a cheap shadow runs beside the primary over the same input, and
 * a scorer measures the gap. It answers whether the cheaper seat would have
 * been good enough. The shadow is an experiment, so its failure is
 * quarantined; the primary is not a fallback ladder, so its failure fails the
 * run.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { PatternError } from "./PatternError.js"

/**
 * The two scores a comparison produces.
 *
 * @category models
 * @since 0.0.13
 */
export interface Scores {
  readonly primary: number
  readonly shadow: number
}

/**
 * A scored comparison. `difference` is `primary - shadow`, so a positive
 * difference means the primary was better. `cheaperWins` is true when the
 * shadow matched or beat the primary. Every number is finite.
 *
 * @category models
 * @since 0.0.13
 */
export interface Delta extends Scores {
  readonly difference: number
  readonly cheaperWins: boolean
}

/**
 * The shadow's outcome. A quarantined shadow carries its `Cause`, so the
 * experiment's failure can be read without the run failing.
 *
 * @category models
 * @since 0.0.13
 */
export type Shadow<S> =
  | { readonly quarantined: false; readonly value: S }
  | { readonly quarantined: true; readonly cause: Cause.Cause<unknown> }

/**
 * One sidecar run. `delta` is absent when there is no scorer or the shadow
 * was quarantined.
 *
 * @category models
 * @since 0.0.13
 */
export interface Result<P, S> {
  readonly primary: P
  readonly shadow: Shadow<S>
  readonly delta?: Delta | undefined
}

/**
 * The stages of {@link run}. `score` receives both outputs and runs only when
 * the shadow produced one; its failure is the run's failure.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options<I, P, S, E, R, E2, R2, E3 = never, R3 = never> {
  readonly primary: (input: I) => Effect.Effect<P, E, R>
  readonly shadow: (input: I) => Effect.Effect<S, E2, R2>
  readonly score?:
    | ((input: { readonly primary: P; readonly shadow: S }) => Effect.Effect<Scores, E3, R3>)
    | undefined
}

// Scores are data a scorer returned, so a non-finite one is an input fault.
const scoreRefusal = (primary: number, shadow: number): PatternError | undefined => {
  if (!Number.isFinite(primary)) {
    return new PatternError({
      code: "invalid_input",
      message: `Sidecar primary score must be a finite number, received ${primary}`
    })
  }
  if (!Number.isFinite(shadow)) {
    return new PatternError({
      code: "invalid_input",
      message: `Sidecar shadow score must be a finite number, received ${shadow}`
    })
  }
  const difference = primary - shadow
  return Number.isFinite(difference) ? undefined : new PatternError({
    code: "invalid_input",
    message: `Sidecar score difference must be a finite number, received ${difference}`
  })
}

const measuredDelta = (primary: number, shadow: number): Delta => ({
  primary,
  shadow,
  difference: Number((primary - shadow).toFixed(12)),
  cheaperWins: shadow >= primary
})

/**
 * Compares two scores. The difference is rounded to twelve decimal places, so
 * `0.8` and `0.5` differ by `0.3`, not `0.30000000000000004`. A tie counts as
 * `cheaperWins`.
 *
 * @throws {PatternError} `invalid_input` when a score or the difference is not finite.
 * @category combinators
 * @since 0.0.13
 */
export const delta = (primary: number, shadow: number): Delta => {
  const refusal = scoreRefusal(primary, shadow)
  if (refusal !== undefined) throw refusal
  return measuredDelta(primary, shadow)
}

/**
 * Runs the primary and the shadow concurrently, then scores the pair when
 * there is a scorer and the shadow succeeded. The shadow's failure, a defect
 * or a throw in its callback included, is quarantined; an interruption is
 * not, because a cancelled run is cancelled.
 *
 * Fails with the primary's failure, the scorer's failure, or `PatternError`
 * (`invalid_input`) when a score or their difference is not finite.
 *
 * @category combinators
 * @since 0.0.13
 */
export const run = <I, P, S, E, R, E2, R2, E3 = never, R3 = never>(
  input: I,
  options: Options<I, P, S, E, R, E2, R2, E3, R3>
): Effect.Effect<Result<P, S>, E | E3 | PatternError, R | R2 | R3> => {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the options in between must not reach it.
  const stages = { primary: options.primary, shadow: options.shadow, score: options.score }
  return Effect.gen(function*() {
    // Suspended, so a shadow callback that throws before it returns an Effect
    // is a defect the quarantine claims.
    const quarantine: Effect.Effect<Shadow<S>, never, R2> = Effect.flatMap(
      Effect.exit(Effect.suspend(() => stages.shadow(input))),
      (exit) =>
        Exit.isSuccess(exit)
          ? Effect.succeed<Shadow<S>>({ quarantined: false, value: exit.value })
          : Cause.hasInterrupts(exit.cause)
          ? Effect.interrupt
          : Effect.succeed<Shadow<S>>({ quarantined: true, cause: exit.cause })
    )
    const [primary, shadow] = yield* Effect.all([stages.primary(input), quarantine] as const, { concurrency: 2 })
    if (stages.score === undefined || shadow.quarantined) {
      const reported: Result<P, S> = { primary, shadow }
      return reported
    }
    const scores = yield* stages.score({ primary, shadow: shadow.value })
    const refusal = scoreRefusal(scores.primary, scores.shadow)
    if (refusal !== undefined) return yield* Effect.fail(refusal)
    const reported: Result<P, S> = { primary, shadow, delta: measuredDelta(scores.primary, scores.shadow) }
    return reported
  })
}
