import { Effect, Fiber } from "effect"
export function main(): Effect.Effect<number> { return Effect.gen(function* () {
  const child = yield* Effect.forkChild(Effect.succeed(Effect.fail("inner")))
  return yield* Effect.catch(yield* Fiber.join(child), (e: string) => Effect.succeed(e.length))
}) }
