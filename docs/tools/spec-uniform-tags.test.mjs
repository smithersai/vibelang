import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

test("tag coverage counts recognized member cases without inventing uniform-tag narrowing", () => {
  const match = chapter("004-match")
  assert.ok(!match.includes("treats it exactly as TypeScript treats"))
  assert.ok(match.includes("Coverage is per normalized member and tag case"))
  assert.ok(match.includes("including a plain object with that tag; other tag cases on that member remain"))
  assert.ok(match.includes("only when their argument list has the required length"))
  assert.ok(match.includes("bare `let` or `const` binding"))
  assert.ok(read("docs/design/vips/0007-match.md").includes("even when TypeScript does not narrow the whole subject"))
  assert.ok(read("docs/user/src/vibelang-features/116-match-and-is.md").includes("Members sharing a literal `_tag` are covered"))
  assert.ok(!read("docs/user/src/vibelang-features/116-match-and-is.md").includes("is not checked, so give its"))
  const types = block(match, "function sharedTagSwitch")
  const errors = block(match, "const sameTagExit")
  const result = run(types + "\n" + errors + `
import assert from "node:assert/strict"
assert.equal(sharedTagSwitch({ _tag: "A", x: 1 }), 1)
assert.equal(sharedTagSwitch({ _tag: "A", y: 2 }), 1)
assert.equal(sharedTagPattern({ _tag: "A", x: 1 }), 1)
assert.equal(sharedTagPattern({ _tag: "A", y: 2 }), 1)
assert.equal(sameTagExit._tag, "Success")
assert.deepEqual(sameTagExit.value, [1, 1])
// Covering A alone leaves B on a member whose tag is a union.
const recognizeA = (s) => s._tag === "A"
assert.equal(recognizeA({ _tag: "B" }), false)
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
