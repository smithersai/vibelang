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
