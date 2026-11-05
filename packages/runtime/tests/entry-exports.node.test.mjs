import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import * as entry from "vibelang-runtime"
import * as abi from "../dist/index.js"

test("Node's guarded package entry retains every ABI value and identity", () => {
  assert.deepEqual(Object.keys(entry), Object.keys(abi))
  for (const name of Object.keys(abi)) assert.equal(entry[name], abi[name], name)
})
test("Node's package entry registers generated family matchers across subclass histories", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 8 }), fc.string(), fc.boolean(), (depth, tag, matching) => {
    const matcher = subject => subject !== null && typeof subject === "object" && subject._tag === tag
    assert.equal(entry.$registerErrorMatcher(matcher), matcher)
    class Family {}
    Object.defineProperty(Family, entry.customMatcher, { value: matcher })
    let Child = Family
    for (let i = 0; i < depth; i++) Child = class extends Child {}
    assert.equal(entry.$is(Child, { _tag: matching ? tag : tag + "\0" }), matching)
  }), { seed: 74219, numRuns: 500 })
})
