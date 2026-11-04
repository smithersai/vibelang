import { Effect } from "effect"
export const main = () => Effect.gen(function* () {
  let total = 0
  yield* Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
    total += 1
    yield* restore(Effect.sync(() => { total += 1 }))
    yield* Effect.interruptible(Effect.sync(() => { total += 1 }))
  }))
  return total
})
