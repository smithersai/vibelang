import assert from "node:assert/strict"
import test from "node:test"
import { chapter } from "./spec-witness.mjs"

test("EK2104 covers a nongenerator effect body without requiring an outer producer", () => {
  for (const text of [chapter("900-appendices"), chapter("002-running")]) {
    const row = text.split("\n").find(line => line.includes("| `EK2104` |") || line.endsWith("| `EK2104` |"))
    assert.ok(row, "the code must be inventoried in both chapters")
    assert.match(row, /nonproducer effect code/)
    assert.match(row, /whether or not an outer producer exists/)
  }
  assert.match(chapter("002-running"), /plain nongenerator function or arrow retains TypeScript.s own restrictions and diagnostics/)
})

test("native generator ownership does not cross nongenerator function boundaries", () => {
  for (const source of [
    "async function f() { yield 1 }",
    "async function* outer() { const inner = () => { yield 1 } }",
    "async function* outer() { async function inner() { yield 1 } }",
    "async function* outer() { function inner() { yield 1 } }"
  ]) assert.throws(() => new Function(`\"use strict\"; ${source}`), SyntaxError)
  const first = new Function("\"use strict\"; async function f() { function* own() { yield 1 }; return own().next().value }; return f()")()
  return first.then(value => assert.equal(value, 1))
})
