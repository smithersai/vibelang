// The hand-written Effect TypeScript loops, with the same step as
// `vibe-loops.vibe`.
import { Data, Effect } from "effect"

export class Overflow extends Data.TaggedError("Overflow")<{ readonly value: number }> {}

// An `Effect.fn` generator, the usual Effect spelling of `step`.
export const fnStep = Effect.fn(function* (n: number) {
  const next = n + 1
  if (next % 250_000 === 0) return yield* Effect.fail(new Overflow({ value: next }))
  return next
})

export const fnLoop = (count: number) =>
  Effect.gen(function* () {
    let n = 0
    for (let i = 0; i < count; i++) n = yield* fnStep(n)
    return n
  })

// `Effect.succeed` and `Effect.fail` without a generator, recovered by
// `Effect.orElseSucceed`.
export const directStep = (n: number): Effect.Effect<number, Overflow> => {
  const next = n + 1
  return next % 250_000 === 0 ? Effect.fail(new Overflow({ value: next })) : Effect.succeed(next)
}

export const orElseSucceedLoop = (count: number) =>
  Effect.gen(function* () {
    let n = 0
    for (let i = 0; i < count; i++) n = yield* Effect.orElseSucceed(directStep(n), () => 0)
    return n
  })
