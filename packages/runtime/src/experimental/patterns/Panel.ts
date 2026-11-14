/**
 * A panel: several panelists answer the same input, and one moderator reads
 * every answer.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Effect from "effect/Effect"
import { concurrencyRefusal } from "./internal.js"
import { PatternError } from "./PatternError.js"

/**
 * The stages of {@link run}. Panelists are a record so each opinion has a
 * stable name. `concurrency` bounds how many panelists run at once; without
 * it they all start together.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options<I, A, E, R, B, E2, R2> {
  readonly panelists: Readonly<Record<string, (input: I) => Effect.Effect<A, E, R>>>
  readonly moderator: (
    input: { readonly input: I; readonly opinions: Readonly<Record<string, A>> }
  ) => Effect.Effect<B, E2, R2>
  readonly concurrency?: number | undefined
}

/**
 * Runs every panelist against the same input and hands the moderator one
 * record of opinions keyed by panelist name. Keys follow the order the
 * panelists were written in, whatever order they finish in. One panelist's
 * failure fails the panel and interrupts the others.
 *
 * Fails with `PatternError` (`invalid_decorator`) when there is no panelist
 * or `concurrency` is not a positive safe integer.
 *
 * @category combinators
 * @since 0.0.13
 */
export const run = <I, A, E, R, B, E2, R2>(
  input: I,
  options: Options<I, A, E, R, B, E2, R2>
): Effect.Effect<B, E | E2 | PatternError, R | R2> => {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the options in between must not reach it.
  const panelists = Object.entries(options.panelists)
  const moderator = options.moderator
  const concurrency = options.concurrency
  return Effect.suspend((): Effect.Effect<B, E | E2 | PatternError, R | R2> => {
    if (panelists.length === 0) {
      return Effect.fail(
        new PatternError({ code: "invalid_decorator", message: "Panel requires at least one panelist" })
      )
    }
    const width = concurrency === undefined ? undefined : concurrencyRefusal("Panel", concurrency)
    if (width !== undefined) return Effect.fail(width)
    return Effect.flatMap(
      Effect.forEach(
        panelists,
        ([name, panelist]) => Effect.map(panelist(input), (opinion) => [name, opinion] as const),
        { concurrency: concurrency ?? "unbounded" }
      ),
      (opinions) => moderator({ input, opinions: Object.fromEntries(opinions) })
    )
  })
}
