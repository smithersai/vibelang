import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"

export const expected = Effect.gen(function* () {
  const fiber = yield* Effect.forkChild(Effect.never)
  yield* Fiber.interrupt(fiber)
  return 1
})
