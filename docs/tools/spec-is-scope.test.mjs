import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

test("is tests have a counterpart and lexical visibility does not depend on successful matching", () => {
  const match = chapter("004-match")
  assert.ok(match.includes("## `is` expressions"))
  assert.ok(match.includes("They are in scope in both branches and after the `if`"))
  assert.ok(match.includes("A failed overall test does not undo bindings already initialized"))
  assert.ok(match.includes("Each cell stays in TDZ until its binding pattern executes"))
  assert.ok(read("docs/user/src/vibelang-features/116-match-and-is.md").includes("a later pattern failure does not undo an earlier initialization"))
  assert.ok(match.includes("their `or` replacement exception"))
  const result = run(block(match, "const isNamesExit") + `
import assert from "node:assert/strict"
assert.equal(isNamesExit._tag, "Success")
assert.deepEqual(isNamesExit.value, ["Ada", "missing"])
assert.equal(failedGuardCellExit._tag, "Success")
assert.equal(failedGuardCellExit.value, 5)
assert.equal(skippedBindingCellExit._tag, "Failure")
assert.ok(skippedBindingCellExit.cause.reasons.some(reason => reason._tag === "Die" && reason.defect instanceof ReferenceError))
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
