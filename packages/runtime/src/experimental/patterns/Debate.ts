/**
 * A debate: a proponent and an opponent take turns for a bounded number of
 * rounds, and a judge settles it from the transcript.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Effect from "effect/Effect"
import { PatternError } from "./PatternError.js"

/**
 * One round of the transcript. The turn is frozen; the values in it are the
 * participants' own and are not frozen.
 *
 * @category models
 * @since 0.0.13
 */
export interface RuntimeTurn<Proponent, Opponent> {
  readonly proponent: Proponent
  readonly opponent: Opponent
}

/**
 * The stages of {@link run}. Each stage sees a frozen copy of the
 * transcript so far; `round` counts from 1, and the opponent also sees this
 * round's `proponent`.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options<I, Proponent, Opponent, Judge, E, R, E2, R2, E3, R3> {
  readonly rounds: number
  readonly proponent: (state: {
    readonly input: I
    readonly transcript: ReadonlyArray<RuntimeTurn<Proponent, Opponent>>
    readonly round: number
  }) => Effect.Effect<Proponent, E, R>
  readonly opponent: (state: {
    readonly input: I
    readonly transcript: ReadonlyArray<RuntimeTurn<Proponent, Opponent>>
    readonly proponent: Proponent
    readonly round: number
  }) => Effect.Effect<Opponent, E2, R2>
  readonly judge: (state: {
    readonly input: I
    readonly transcript: ReadonlyArray<RuntimeTurn<Proponent, Opponent>>
  }) => Effect.Effect<Judge, E3, R3>
}

/**
 * Runs `rounds` rounds of proponent then opponent, then gives the judge the
 * whole transcript and returns its verdict.
 *
 * Fails with `PatternError` (`invalid_decorator`) when `rounds` is not a
 * positive safe integer.
 *
 * @category combinators
 * @since 0.0.13
 */
export const run = <I, Proponent, Opponent, Judge, E, R, E2, R2, E3, R3>(
  input: I,
  options: Options<I, Proponent, Opponent, Judge, E, R, E2, R2, E3, R3>
): Effect.Effect<Judge, E | E2 | E3 | PatternError, R | R2 | R3> => {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the options in between must not reach it.
  const participants = { proponent: options.proponent, opponent: options.opponent, judge: options.judge }
  const rounds = options.rounds
  if (!Number.isSafeInteger(rounds) || rounds < 1) {
    return Effect.fail(
      new PatternError({ code: "invalid_decorator", message: `Debate rounds must be a positive safe integer, received ${rounds}` })
    )
  }
  return Effect.gen(function*() {
    const transcript: Array<RuntimeTurn<Proponent, Opponent>> = []
    const snapshot = (): ReadonlyArray<RuntimeTurn<Proponent, Opponent>> => Object.freeze([...transcript])
    for (let round = 1; round <= rounds; round++) {
      const proponent = yield* participants.proponent({ input, transcript: snapshot(), round })
      const opponent = yield* participants.opponent({ input, transcript: snapshot(), proponent, round })
      transcript.push(Object.freeze({ proponent, opponent }))
    }
    return yield* participants.judge({ input, transcript: snapshot() })
  })
}
