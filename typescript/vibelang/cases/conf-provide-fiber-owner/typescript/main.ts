import { Effect, Fiber, Layer } from "effect"
export const main = () => Effect.gen(function* () {
  let direct: Fiber.Fiber<number>
  yield* Effect.provide(Effect.gen(function* () {
    direct = yield* Effect.forkChild(Effect.succeed(1))
  }), Layer.empty)
  const a = yield* Fiber.join(direct!)

  let nested: Fiber.Fiber<number>
  yield* Effect.provide(Effect.gen(function* () {
    yield* Effect.provide(Effect.gen(function* () {
      nested = yield* Effect.forkChild(Effect.succeed(2))
    }), [Layer.empty, Layer.empty])
  }), Layer.empty)
  const b = yield* Fiber.join(nested!)

  let aliased: Fiber.Fiber<number>
  yield* Effect.provide(Effect.gen(function* () {
    const local = yield* Effect.forkChild(Effect.succeed(3))
    aliased = local
  }), Layer.empty)
  const c = yield* Fiber.join(aliased!)

  let d = 0
  for (const n of [4]) {
    let iteration: Fiber.Fiber<number>
    yield* Effect.provide(Effect.gen(function* () {
      iteration = yield* Effect.forkChild(Effect.succeed(n))
    }), Layer.empty)
    d = yield* Fiber.join(iteration!)
  }
  return [a, b, c, d]
})
