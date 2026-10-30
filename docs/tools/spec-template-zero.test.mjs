import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

test("primitive templates follow the formal grammar and never coerce subjects", () => {
  const match = chapter("004-match")
  assert.ok(match.includes("An interpolated template in pattern position is a syntax error"))
  assert.ok(match.includes("A no-substitution template uses general `SameValueZero`"))
  const pin = read("docs/design/vips/tc39-pattern-matching/README.md")
  assert.ok(pin.includes("| Primitive template patterns |"))
  assert.ok(pin.includes("| Template equality |"))
  const result = run(block(match, "const templateExit") + `
import assert from "node:assert/strict"
assert.equal(templateExit._tag, "Success")
assert.deepEqual(templateExit.value, ["literal", "guard", "miss"])
for (const s of [0, null, undefined, Symbol(), {}, { toString() { throw "coerced" } }]) {
  assert.equal(templateLabel(s, "B"), "miss")
}
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test("signed Number zero is partial but unsigned zero and nonzero literals retain their tests", () => {
  const match = chapter("004-match")
  assert.ok(match.includes("covers no zero case"))
  assert.ok(match.includes("Even both signed arms together give no whole-case proof"))
  assert.ok(match.includes("zero-valued enum case"))
  const result = run(block(match, "const positiveZeroExit") + `
import assert from "node:assert/strict"
assert.equal(positiveZeroExit._tag, "Failure")
assert.equal(negativeZeroExit._tag, "Success")
assert.equal(negativeZeroExit.value, "negative")
assert.equal(unsignedZeroExit._tag, "Success")
assert.deepEqual(unsignedZeroExit.value, ["zero", "zero", "negative one"])
for (const zero of [+0, -0, -0.0, +0e0, -0x0]) {
  assert.equal(Object.is(zero, 0) && Object.is(zero, -0), false)
  assert.equal(zero === 0, true)
}
assert.equal(Object.is(-0n, 0n), true)
assert.equal(Object.is(-1, -1), true)
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
