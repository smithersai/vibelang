import { Effect, Stream, Deferred, Fiber } from "effect"
export function main(): Effect.Effect<number> {
 return Effect.gen(function* () {
  const ready = yield* Deferred.make<void>()
  const release = yield* Deferred.make<void>()
  let child: Fiber.Fiber<number> | undefined
  yield* Stream.runForEachWhile(Stream.make(7), n => Effect.gen(function* () {
    child = yield* Effect.forkChild(Effect.gen(function* () {
      yield* Deferred.succeed(ready, undefined)
      yield* Deferred.await(release)
      return n
    }))
    yield* Deferred.await(ready)
    return true
  }))
  yield* Deferred.succeed(release, undefined)
  return yield* Fiber.join(child!)
 })
}
