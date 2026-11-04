import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
export function main() { return Effect.gen(function* () {
 const scope = yield* Scope.make()
 const a = yield* Effect.forkIn(Effect.succeed(1), scope)
 const b = yield* Effect.forkDetach(Effect.succeed(2))
 const c = yield* Effect.scoped(Effect.gen(function* () { const f = yield* Effect.forkScoped(Effect.succeed(3)); return yield* Fiber.join(f) }))
 const x = yield* Effect.forkChild(Effect.succeed(4)), y = yield* Effect.forkChild(Effect.succeed(5))
 const values = [yield* Fiber.join(a), yield* Fiber.join(b), c, yield* Fiber.join(x), yield* Fiber.join(y)]
 yield* Scope.close(scope, Exit.void)
 return values
}) }
