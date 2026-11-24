import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { Effect, Exit } from "effect"
import { chapter, read } from "./spec-witness.mjs"

// VIP-41: "direct match-arm body has its separate ... production" and
// "throws the full operand, as a throw statement does". The generic arm
// must exclude initial throw now that VIP-41 also adds unary throw.
const hasDisjointArms = text =>
  /^ArmBody = \[lookahead ≠ "throw"\] Expression \| "throw" Expression$/m.test(text)

test("direct throwing match arms have one applicable production", () => {
  assert.ok(hasDisjointArms(chapter("900-appendices")), "generic ArmBody must exclude initial throw")
  assert.match(read("docs/design/vips/0041-throw-expressions.md"), /direct match-arm body has its separate/)
})


test("generated in operands expose different Exit values for the two old derivations", () => {
  fc.assert(fc.property(fc.string(), fc.boolean(), (key, present) => {
    const object = Object.create(null)
    if (present) Object.defineProperty(object, key, { value: 1 })
    const direct = Effect.runSyncExit(Effect.gen(function* () {
      return yield* Effect.fail(key in object)
    }))
    const expression = Effect.runSyncExit(Effect.gen(function* () {
      return (yield* Effect.fail(key)) in object
    }))
    assert.ok(Exit.isFailure(direct))
    assert.ok(Exit.isFailure(expression))
    assert.deepEqual(direct, Effect.runSyncExit(Effect.fail(present)))
    assert.deepEqual(expression, Effect.runSyncExit(Effect.fail(key)))
    assert.notDeepEqual(direct, expression)
  }), { seed: 19004, numRuns: 200 })
})
