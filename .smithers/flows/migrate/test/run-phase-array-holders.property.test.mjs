import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"
import { originalFunctions } from "../lib/run-phase.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")

const functions = text => originalFunctions(ts, 'import { Effect } from "effect"; const make = () => ' + text)

test("tuple callbacks keep the Effect factory distinct from the tuple holder", () => {
  const found = functions('items.map(([key, call]) => [key, Effect.fn(function* () { return yield* call() })])')
  assert.equal(found.get("make/items.map(0)").kind, "plain")
  assert.equal(found.get("make/items.map(0).[1]")?.kind, "effect")
})

test("property: each array position keeps its function kind through nesting and assertions", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 0, max: 3 }), fc.boolean(), (depth, slot, asserted) => {
    let expression = '[() => 1, Effect.fn(function* () { return 1 }), () => Effect.gen(function* () { return 1 }), function () { return 1 }]'
    for (let i = 1; i < depth; i++) expression = '[null, ' + expression + ']'
    if (asserted) expression = '(' + expression + ' as const)'
    const found = functions(expression)
    const path = "make" + ".[1]".repeat(depth - 1) + ".[" + slot + "]"
    assert.equal(found.get(path)?.kind, slot === 1 ? "effect" : "plain")
  }), { numRuns: 80 })
})
