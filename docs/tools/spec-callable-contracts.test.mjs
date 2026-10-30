import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"

test("local implementations meet every overload bound, including the effectful implicit never bound", () => {
  for (const text of [chapter("001-functions"), chapter("003-failures")]) {
    assert.match(text, /every exposed overload/)
    assert.match(text, /parameter\/default initialization/)
    assert.match(text, /`EK0401`/)
    assert.match(text, /implicit `never`/)
  }
  assert.match(chapter("900-appendices"), /local implementation.*effectful overload/)
})

test("rethrows admission survives aliases, returned values, nested captures and object callable members", () => {
  const text = chapter("001-functions")
  assert.match(text, /admitted thrown bound of `unknown`/)
  for (const term of ["returning", "storing", "assigning", "nested", "object", "immediately invoked"]) {
    assert.ok(text.includes(term), term)
  }
  assert.match(text, /@throws \{unknown\}.*\(\): number/s)
  assert.match(chapter("003-failures"), /admitted thrown bound of `unknown`/)
})

test("the printed references distinguish a hidden synchronous throw, an unwrapped callback defect and a wrapped failure", () => {
  const result = run(block(chapter("001-functions"), "// Callable-contract reference witnesses"))
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), [["Die", "boom"], ["Die", "callback"], ["Fail", "callback"]])
})
