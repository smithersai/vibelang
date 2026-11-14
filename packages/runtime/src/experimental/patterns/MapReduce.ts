/**
 * Map-reduce: map every shard of the input at a concurrency bound, then
 * reduce the mapped values in shard order.
 *
 * @experimental
 * @since 0.0.13
 */
import * as Effect from "effect/Effect"
import { PatternError } from "./PatternError.js"

/**
 * What an input with no shards does. `reduce` hands the reducer an empty
 * list, `succeed` returns an empty list without reducing, and `fail` fails
 * with a `PatternError` whose code is `exhausted`.
 *
 * @category models
 * @since 0.0.13
 */
export type OnEmpty = "reduce" | "succeed" | "fail"

/**
 * The stages of {@link run}. `map` receives one shard, its index and the
 * whole input; `reduce` receives the input and the mapped values in shard
 * order.
 *
 * @category models
 * @since 0.0.13
 */
export interface Options<I, Shard, Mapped, Reduced, E, R, E2, R2> {
  readonly map: (input: { readonly shard: Shard; readonly index: number; readonly input: I }) => Effect.Effect<Mapped, E, R>
  readonly reduce: (input: { readonly input: I; readonly mapped: ReadonlyArray<Mapped> }) => Effect.Effect<Reduced, E2, R2>
  readonly concurrency: number
  readonly onEmpty: OnEmpty
}

/**
 * Maps every shard of `input.shards`, at most `concurrency` at a time, and
 * reduces the mapped values in shard order, whatever order the maps finish
 * in. The first map failure interrupts the rest. Under `onEmpty: "succeed"`
 * an input with no shards gives an empty list, so the result type also
 * admits one.
 *
 * Fails with `PatternError`: `invalid_decorator` when `concurrency` is not a
 * positive safe integer, and `exhausted` for an input with no shards under
 * `onEmpty: "fail"`.
 *
 * @category combinators
 * @since 0.0.13
 */
export function run<I extends { readonly shards: ReadonlyArray<unknown> }, Mapped, Reduced, E, R, E2, R2>(
  input: I,
  options: Options<I, I["shards"][number], Mapped, Reduced, E, R, E2, R2> & { readonly onEmpty: "reduce" | "fail" }
): Effect.Effect<Reduced, E | E2 | PatternError, R | R2>
export function run<I extends { readonly shards: ReadonlyArray<unknown> }, Mapped, Reduced, E, R, E2, R2>(
  input: I,
  options: Options<I, I["shards"][number], Mapped, Reduced, E, R, E2, R2>
): Effect.Effect<Reduced | ReadonlyArray<Mapped>, E | E2 | PatternError, R | R2>
export function run<I extends { readonly shards: ReadonlyArray<unknown> }, Mapped, Reduced, E, R, E2, R2>(
  input: I,
  options: Options<I, I["shards"][number], Mapped, Reduced, E, R, E2, R2>
): Effect.Effect<Reduced | ReadonlyArray<Mapped>, E | E2 | PatternError, R | R2> {
  // Read once, at the call: the Effect may run later, and a caller's edit to
  // the shard list or the options in between must not reach it. The input
  // itself reaches the stages as the caller's object.
  const stages = { map: options.map, reduce: options.reduce }
  const concurrency = options.concurrency
  const onEmpty = options.onEmpty
  const shards: ReadonlyArray<I["shards"][number]> = [...input.shards]
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    return Effect.fail(
      new PatternError({ code: "invalid_decorator", message: "MapReduce concurrency must be a positive safe integer" })
    )
  }
  if (shards.length === 0) {
    if (onEmpty === "fail") {
      return Effect.fail(new PatternError({ code: "exhausted", message: "MapReduce received no shards" }))
    }
    return onEmpty === "succeed" ? Effect.succeed([]) : Effect.suspend(() => stages.reduce({ input, mapped: [] }))
  }
  return Effect.flatMap(
    Effect.forEach(shards, (shard, index) => stages.map({ shard, index, input }), { concurrency }),
    (mapped) => stages.reduce({ input, mapped })
  )
}
