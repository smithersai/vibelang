import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"

test("the cache example is a native witness rather than a mutable-intrinsic recipe", () => {
  const match = chapter("004-match")
  assert.ok(!match.includes("For this native generator, the cache and finishing step specialize to:"))
  assert.ok(!match.includes("function pairs(g: Generator<number, void, unknown>) {\n  const apply = Reflect.apply"))
  assert.ok(match.includes("the witness does not prescribe a matcher lowering"))
  const result = run(block(match, "const pairCacheExit") + `
import assert from "node:assert/strict"
assert.equal(pairCacheExit._tag, "Success")
assert.equal(pairCacheExit.value, 3)
const original = Reflect.apply
let value
try {
  Reflect.apply = () => { throw "poison" }
  value = pairCacheWitness()
} finally { Reflect.apply = original }
assert.equal(value, 3)
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
