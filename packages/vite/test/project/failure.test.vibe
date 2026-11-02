import { assert, it } from "@effect/vitest"
import { Effect } from "effect"

it.effect("reports the original assertion line", () => {
  const value = Effect.succeed(41)
  Effect.sync(() => assert.strictEqual(value, 42))
})
