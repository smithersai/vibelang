/**
 * A bounded review loop: produce, review, and revise until a review approves
 * or the rounds are spent.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Effect from "effect/Effect"
import { accepted as isAccepted } from "./internal.js"
import { PatternError } from "./PatternError.js"
import * as Stall from "./Stall.js"

/**
 * A stall breaker for the loop. `signals` reads what to compare from each
 * reviewed output; without it the output itself is compared.
 *
 * @category models
 * @since 0.0.13
 */
export interface StallOptions<A> extends Stall.Options {
  readonly signals?: ((output: A) => Stall.Observation) | undefined
}

/**
 * The stages of {@link run}. `review` receives the output and the round,
 * counted from 1. `maxRounds` is how many reviews the loop may hold.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options<I, A, Review, E, R, E2, R2, E3, R3> {
  readonly produce: (input: I) => Effect.Effect<A, E, R>
  readonly review: (output: A, round: number) => Effect.Effect<Review, E2, R2>
  readonly revise: (input: {
    readonly output: A
    readonly review: Review
    readonly round: number
  }) => Effect.Effect<A, E3, R3>
  readonly maxRounds: number
  readonly stall?: StallOptions<A> | undefined
}

/**
 * A review approved the output.
 *
 * @category models
 * @since 0.0.13
 */
export interface Approved<A> {
  readonly _tag: "Approved"
  readonly output: A
}

/**
 * Every round was spent. `review` is the last one.
 *
 * @category models
 * @since 0.0.13
 */
export interface Exhausted<A, Review> {
  readonly _tag: "Exhausted"
  readonly output: A
  readonly review: Review
}

/**
 * The stall breaker ended the loop: the reviewed output repeated.
 *
 * @category models
 * @since 0.0.13
 */
export interface Stalled<A, Review> {
  readonly _tag: "Stalled"
  readonly output: A
  readonly review: Review
  readonly stalled: Stall.Stalled
}

/**
 * How a review loop ends.
 *
 * @category models
 * @since 0.0.13
 */
export type Settled<A, Review> = Approved<A> | Exhausted<A, Review> | Stalled<A, Review>

/**
 * Whether a review approves: `true`, `"approved"`, or an object whose own
 * `approved` or `accepted` property is `true`.
 *
 * @throws never
 * @category introspection
 * @since 0.0.13
 */
export const accepted = (review: unknown): boolean => isAccepted(review)

/**
 * Produces an output, then reviews and revises it until a review approves,
 * the rounds are spent, or the stall breaker ends the loop. The last round
 * reviews and never revises.
 *
 * Fails with `PatternError`: `invalid_decorator` when `maxRounds` is not a
 * positive safe integer or the stall `rounds` is not a safe integer of at
 * least 2, and `stalled` when a breaker with `on: "escalate"` trips.
 *
 * @category combinators
 * @since 0.0.13
 */
export const run = <I, A, Review, E, R, E2, R2, E3, R3>(
  input: I,
  options: Options<I, A, Review, E, R, E2, R2, E3, R3>
): Effect.Effect<Settled<A, Review>, E | E2 | E3 | PatternError, R | R2 | R3> => {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the options in between must not reach it.
  const stages = { produce: options.produce, review: options.review, revise: options.revise }
  const maxRounds = options.maxRounds
  if (!Number.isSafeInteger(maxRounds) || maxRounds < 1) {
    return Effect.fail(
      new PatternError({ code: "invalid_decorator", message: "ReviewLoop maxRounds must be a positive safe integer" })
    )
  }
  const stall = options.stall === undefined ? undefined : Stall.policy(options.stall)
  if (options.stall !== undefined && stall === undefined) {
    return Effect.fail(
      new PatternError({
        code: "invalid_decorator",
        message: "ReviewLoop stall rounds must be a safe integer of at least 2"
      })
    )
  }
  const signals = options.stall?.signals ?? ((output: A): Stall.Observation => ({ output }))
  return Effect.gen(function*() {
    let streaks = Stall.initial
    let output = yield* stages.produce(input)
    let round = 1
    while (true) {
      const review = yield* stages.review(output, round)
      if (isAccepted(review)) {
        const approved: Approved<A> = { _tag: "Approved", output }
        return approved
      }
      if (round === maxRounds) {
        const spent: Exhausted<A, Review> = { _tag: "Exhausted", output, review }
        return spent
      }
      if (stall !== undefined) {
        const observed = Stall.observe(stall, streaks, signals(output))
        streaks = observed.state
        const stalled = observed.stalled
        if (stalled !== undefined) {
          if (stalled.on === "escalate") {
            return yield* Effect.fail(
              new PatternError({
                code: "stalled",
                message: `ReviewLoop stalled: the same result for ${stalled.rounds} rounds in a row`
              })
            )
          }
          const parked: Stalled<A, Review> = { _tag: "Stalled", output, review, stalled }
          return parked
        }
      }
      output = yield* stages.revise({ output, review, round })
      round += 1
    }
  })
}
