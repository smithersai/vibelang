import { Effect, Exit, Fiber, Scope } from "effect"

export function main() {
  return Effect.gen(function* () {
    const scope = yield* Scope.make()
    const first = yield* Effect.raceAll([Effect.succeed(7)])
    const child = yield* Effect.forkIn(Effect.succeed(9), scope)
    const second = yield* Fiber.join(child)
    yield* Scope.close(scope, Exit.succeed(undefined))
    return [first, second]
  })
}
