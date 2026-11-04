import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
import { Deferred, Option } from "effect"
export function main() { return Effect.gen(function* () {
 const observations: boolean[] = []
 for (const detached of [false, true]) {
  const ready = yield* Deferred.make<void>()
  const release = yield* Deferred.make<void>()
  const stopped = yield* Deferred.make<void>()
  const child = Effect.ensuring(Effect.gen(function* () { yield* Deferred.succeed(ready, undefined); yield* Deferred.await(release) }), Deferred.succeed(stopped, undefined))
  const parent = yield* Effect.forkChild(Effect.gen(function* () {
   if (detached) { yield* Effect.forkDetach(child) } else { yield* Effect.forkChild(child) }
   yield* Deferred.await(ready)
  }))
  yield* Fiber.join(parent)
  observations.push(yield* Deferred.isDone(stopped))
  yield* Deferred.succeed(release, undefined)
  yield* Deferred.await(stopped)
 }
 return observations
}) }
