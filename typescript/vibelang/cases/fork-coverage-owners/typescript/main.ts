import { Effect, Fiber, Deferred, Scope, Exit } from "effect"
export function main(): Effect.Effect<number[]> {
 return Effect.gen(function* () {
  const values: number[] = []
  const gate = yield* Deferred.make<void>()
  const ready = yield* Deferred.make<void>()
  function start() {
    return Effect.gen(function* () {
      return yield* Effect.forkChild(Effect.gen(function* () {
        yield* Deferred.succeed(ready, undefined)
        yield* Deferred.await(gate)
        return 7
      }))
    })
  }
  const child = yield* start()
  yield* Deferred.await(ready)
  yield* Deferred.succeed(gate, undefined)
  values.push(yield* Fiber.join(child))
  yield* Effect.scoped(Effect.gen(function* () {
    const scope = yield* Effect.scope
    function owner() { values.push(1); return scope }
    function work() { values.push(2); return Effect.succeed(3) }
    const s = owner()
    const owned = yield* Effect.forkIn(work(), s)
    values.push(9)
    values.push(yield* Fiber.join(owned))
    const scopedChild = yield* Effect.forkScoped(Effect.succeed(4))
    values.push(yield* Fiber.join(scopedChild))
  }))
  const detached = yield* Effect.forkDetach(Effect.succeed(5))
  values.push(yield* Fiber.join(detached))
  return values
 })
}
