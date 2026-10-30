import assert from "node:assert/strict"
import test from "node:test"
import { block, read, run } from "./spec-witness.mjs"

test("the public pattern decision states cell identity across alternatives and loop conditions", () => {
  const vip = read("docs/design/vips/0007-match.md")
  assert.ok(vip.includes("saved closures observe the replacement"))
  assert.ok(vip.includes("Every complete condition evaluation, including after `continue`"))
  assert.ok(vip.includes("closures captured there retain those cells permanently in TDZ"))
  assert.ok(read("docs/design/vips/tc39-pattern-matching/README.md").includes("initial-`do` closures keep their original TDZ cells"))
  const result = run(block(vip, "const loopCellsExit") + `
import assert from "node:assert/strict"
assert.equal(loopCellsExit._tag, "Success")
assert.deepEqual(loopCellsExit.value, [99, 11, 12])
assert.equal(alternativeCellExit._tag, "Success")
assert.deepEqual(alternativeCellExit.value, [true, 1])
assert.equal(initialHeadExit._tag, "Failure")
assert.ok(initialHeadExit.cause.reasons.some(reason => reason._tag === "Die" && reason.defect instanceof ReferenceError))
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
