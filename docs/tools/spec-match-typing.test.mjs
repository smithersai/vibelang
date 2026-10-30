import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"

test("match types follow async adoption and the actual failed matcher tests", () => {
  const match = chapter("004-match")
  assert.ok(match.includes("`Promise<Awaited<U>>`"))
  assert.ok(match.includes("independent of exhaustiveness coverage"))
  assert.ok(match.includes("failure of a guard does not establish that its positive predicate failed"))
  assert.ok(match.includes("the false branch of the actual positive test"))
  assert.ok(!match.includes("`async match` has type `Promise<union>`"))
  const setup = `Object.defineProperty(Symbol, "customMatcher", { value: Symbol.for("Symbol.customMatcher") });\n`
  const result = run(setup + block(match, "const adoptedExit") + `
import assert from "node:assert/strict"
assert.equal(adoptedExit._tag, "Success")
assert.equal(adoptedExit.value, 7)
assert.equal(defaultNarrowingExit._tag, "Success")
assert.deepEqual(defaultNarrowingExit.value, [4, "7"])
assert.equal(!OnlyNumbers[Symbol.customMatcher](new OnlyNumbers()), true)
assert.equal(!OnlyNumbers[Symbol.customMatcher](7), false)
const thenable = { then: (f, g) => Promise.resolve(9).then(f, g) }
assert.equal(await (async () => thenable)(), 9)
function guarded(s, allow) {
  if (isText(s) && allow) return s.length
  return typeof s === "number" ? s.toFixed(0) : "guard-skipped"
}
assert.equal(guarded("text", false), "guard-skipped")
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
