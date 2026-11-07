import { Effect } from "effect"
// The imported returnEffectInGen rule reports a generator that returns an Effect.
export const nested = Effect.gen(function* () {
  return Effect.succeed(2)
})
// Pinned eligibility: a generator that returns a value it ran is not reported.
export const flat = Effect.gen(function* () {
  return yield* Effect.succeed(3)
})
