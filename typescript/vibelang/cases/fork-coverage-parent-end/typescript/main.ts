import { Effect, Deferred, Fiber } from "effect"
export function main(): Effect.Effect<boolean> {
 return Effect.gen(function* () {
  let finalized = false
  const ready = yield* Deferred.make<void>()
  const parent = yield* Effect.forkChild(Effect.gen(function* () {
    yield* Effect.forkChild(Effect.ensuring(Effect.gen(function* () { yield* Deferred.succeed(ready, undefined); yield* Effect.never }), Effect.sync(() => { finalized = true })))
    yield* Deferred.await(ready)
  }))
  yield* Fiber.join(parent)
  return finalized
 })
}
