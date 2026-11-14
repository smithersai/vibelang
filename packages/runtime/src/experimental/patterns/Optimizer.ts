/**
 * An optimizer: generate, evaluate, improve, until a candidate reaches a
 * target score or the iterations are spent. It keeps the best attempt so far,
 * because the last candidate is often not the best one, and hands each
 * generation the attempt before it.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Effect from "effect/Effect"
import { PatternError } from "./PatternError.js"

/**
 * What a spent search does below its target: `"return-last"` settles with
 * the best attempt, and `"fail"` fails with `PatternError` (`exhausted`).
 *
 * @category models
 * @since 0.0.13
 */
export type OnMaxReached = "fail" | "return-last"

/**
 * One scored candidate.
 *
 * @category models
 * @since 0.0.13
 */
export interface Attempt<C> {
  readonly candidate: C
  readonly score: number
  readonly feedback?: unknown | undefined
  readonly iteration: number
}

/**
 * What an evaluator answers for one candidate. `score` is finite; `feedback`
 * is handed to the next generation unchanged.
 *
 * @category models
 * @since 0.0.13
 */
export interface Evaluation {
  readonly score: number
  readonly feedback?: unknown | undefined
}

/**
 * How a search ended. `converged` is true when an attempt reached
 * `targetScore`; `best` is the earliest attempt with the highest score.
 *
 * @category models
 * @since 0.0.13
 */
export interface Result<C> {
  readonly best: Attempt<C>
  readonly iterations: number
  readonly converged: boolean
}

/**
 * The stages of {@link run}. `generate` receives the input, the iteration
 * counted from 1, and from the second iteration on the `previous` attempt.
 * `onMaxReached` defaults to `"return-last"`; `"fail"` needs a `targetScore`.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options<I, C, E, R, E2, R2> {
  readonly generate: (input: {
    readonly input: I
    readonly previous?: Attempt<C> | undefined
    readonly iteration: number
  }) => Effect.Effect<C, E, R>
  readonly evaluate: (input: { readonly value: C; readonly iteration: number }) => Effect.Effect<Evaluation, E2, R2>
  readonly targetScore?: number | undefined
  readonly maxIterations: number
  readonly onMaxReached?: OnMaxReached | undefined
}

const refusal = (options: {
  readonly targetScore?: number | undefined
  readonly maxIterations: number
  readonly onMaxReached?: OnMaxReached | undefined
}): PatternError | undefined => {
  if (options.targetScore !== undefined && !Number.isFinite(options.targetScore)) {
    return new PatternError({ code: "invalid_decorator", message: "Optimizer targetScore must be a finite number" })
  }
  if (options.targetScore === undefined && options.onMaxReached === "fail") {
    return new PatternError({
      code: "invalid_decorator",
      message: "Optimizer onMaxReached 'fail' requires a targetScore to fall short of"
    })
  }
  if (!Number.isSafeInteger(options.maxIterations) || options.maxIterations < 1) {
    return new PatternError({ code: "invalid_decorator", message: "Optimizer maxIterations must be a positive safe integer" })
  }
  return undefined
}

/**
 * Generates and evaluates a candidate each iteration until one scores at
 * least `targetScore` or `maxIterations` are spent. A later attempt replaces
 * the best only by beating it, so equal scores keep the earliest.
 *
 * Fails with `PatternError`: `invalid_decorator` when `targetScore` is not
 * finite, `maxIterations` is not a positive safe integer, or `"fail"` has no
 * target; `invalid_input` when an evaluation's score is not finite; and
 * `exhausted` when a `"fail"` search spends its iterations below target.
 *
 * @category combinators
 * @since 0.0.13
 */
export const run = <I, C, E, R, E2, R2>(
  input: I,
  options: Options<I, C, E, R, E2, R2>
): Effect.Effect<Result<C>, E | E2 | PatternError, R | R2> => {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the options in between must not reach it.
  const { evaluate, generate, maxIterations, targetScore } = options
  const onMaxReached = options.onMaxReached ?? "return-last"
  const refused = refusal({ targetScore, maxIterations, onMaxReached })
  if (refused !== undefined) return Effect.fail(refused)
  return Effect.gen(function*() {
    let previous: Attempt<C> | undefined
    let best: Attempt<C> | undefined
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      const candidate = yield* generate(previous === undefined ? { input, iteration } : { input, previous, iteration })
      const evaluation = yield* evaluate({ value: candidate, iteration })
      const attempt: Attempt<C> = { candidate, score: evaluation.score, feedback: evaluation.feedback, iteration }
      if (!Number.isFinite(attempt.score)) {
        return yield* Effect.fail(
          new PatternError({
            code: "invalid_input",
            message: `Optimizer evaluation score at iteration ${iteration} must be a finite number, received ${attempt.score}`
          })
        )
      }
      if (best === undefined || attempt.score > best.score) best = attempt
      if (targetScore !== undefined && attempt.score >= targetScore) {
        const converged: Result<C> = { best, iterations: iteration, converged: true }
        return converged
      }
      previous = attempt
    }
    if (onMaxReached === "fail") {
      return yield* Effect.fail(
        new PatternError({
          code: "exhausted",
          message: `Optimizer reached its bound of ${maxIterations} iterations below ${targetScore}`
        })
      )
    }
    const spent: Result<C> = { best: best!, iterations: maxIterations, converged: false }
    return spent
  })
}
