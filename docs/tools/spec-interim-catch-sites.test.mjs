import assert from "node:assert/strict"
import test from "node:test"
import { Effect } from "effect"
import { chapter, read } from "./spec-witness.mjs"

// docs/design/src/900-appendices.md#a1a5370c8aa322b4 — Chapter 900: statement and expression dead-catch sites stay distinct.
// docs/design/src/900-appendices.md#e38848aafeb69b68 — Chapter 900: statement and expression dead-catch sites stay distinct.
test("interim EK9204 inventories both sites and their separate retirement", () => {
  const row = chapter("900-appendices").split("\n").find(l => l.startsWith("| interim `EK9204`"))
  assert.match(row, /catch. expression.*cannot fail/)
  assert.match(row, /catch.*keyword/)
  assert.match(row, /EK0503/)
  assert.match(row, /no successor/)
  assert.match(chapter("007-tooling"), /interim `EK92xx` code/)
  assert.match(read("typescript/tsc/internal/vibelang/catch_expressions.go"), /deadCatchExpression = EK9204/)
})

test("generated infallible heads keep their values and never call a handler", () => {
  for (let n = -64; n < 64; n++) {
    let calls = 0
    for (const head of [Effect.succeed(n), Effect.sync(() => n), Effect.gen(function* () { return yield* Effect.succeed(n) })]) {
      assert.equal(Effect.runSync(Effect.catch(head, () => { calls++; return Effect.succeed(99) })), n)
    }
    assert.equal(calls, 0)
    assert.equal(Effect.runSync(Effect.catch(Effect.fail(n), e => { calls++; return Effect.succeed(e) })), n)
    assert.equal(calls, 1)
  }
})
