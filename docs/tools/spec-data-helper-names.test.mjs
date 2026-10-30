import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"

test("data reserves Effect helper names without changing other constructors", () => {
  const data = chapter("006-data")
  assert.ok(data.includes("`$is` and `$match` are reserved variant names in every `data` declaration"))
  assert.match(data, /generic or not \(`EK1602`\)/)
  assert.ok(chapter("900-appendices").includes("| `EK1602` | a `data` variant named"))
  const result = run(block(data, "const safeNameExit") + `
import assert from "node:assert/strict"
assert.equal(safeNameExit._tag, "Success")
assert.deepEqual(safeNameExit.value.map(v => v._tag), ["Is", "Match", "Normal"])
const collisions = Data.taggedEnum()
assert.equal(typeof collisions.$is(), "function")
assert.equal(Effect.runSyncExit(Effect.sync(() => collisions.$match()))._tag, "Failure")
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
