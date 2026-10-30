import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

test("pattern cells retain alternative provenance and per-condition loop identity", () => {
  const match = chapter("004-match")
  for (const text of [
    "later alternative may replace a cell initialized by a failed earlier alternative of that `or`",
    "Do not reset unrelated bindings", "Each complete condition evaluation starts with fresh uninitialized cells",
    "successful condition and its following body share those cells",
    "Short-circuiting past a binding leaves it uninitialized",
    "initial closures are never rebound to a later condition",
    "`if` keeps its existing nearest-block scope",
  ]) assert.ok(match.includes(text), text)
  const pin = read("docs/design/vips/tc39-pattern-matching/README.md")
  assert.ok(pin.includes("| Failed `or` bindings |"))
  assert.ok(pin.includes("| Lexical `is` in loop heads |"))
  const result = run(block(match, "const loopCellsExit") + `
import assert from "node:assert/strict"
assert.equal(loopCellsExit._tag, "Success")
assert.deepEqual(loopCellsExit.value, [99, 11, 12])
assert.equal(initialHeadExit._tag, "Failure")
assert.equal(initialHeadExit.cause.reasons[0]._tag, "Die")
assert.ok(initialHeadExit.cause.reasons[0].defect instanceof ReferenceError)
// A later lexical cell does not rebind a closure over the original cell.
for (const x of [1, 2]) assert.equal(typeof x, "number")
assert.throws(initialReader, ReferenceError)
const readers = []
for (const x of [1, 2]) readers.push(() => x)
assert.deepEqual(readers.map(f => f()), [1, 2])
// Native shared-cell identity is the precedent for failed-alternative replacement.
let cell = 5
const saved = () => cell
cell = [5].length
assert.equal(saved(), 1)
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
