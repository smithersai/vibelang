import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

test("finite coverage uses effective constraints and represented flow without boxing literals", () => {
  const match = chapter("004-match")
  assert.ok(match.includes("Resolve its effective base constraint when one exists"))
  assert.ok(match.includes("If TypeScript still exposes bare `T` after an equality or property guard, its whole constraint remains"))
  assert.ok(match.includes("without apparent-type boxing to `Number`, `String` or `Boolean`"))
  assert.ok(match.includes('function missingTag<T extends TaggedDomain>'))
  assert.ok(match.includes('function letters<T extends "A" | "B">'))
  assert.ok(match.includes('function broad<T extends string>'))
  assert.ok(match.includes('exhaustive: represented intersection'))
  assert.ok(match.includes('EK4701: reference still has type T'))
  assert.ok(match.includes('exhaustive: represented union refinement'))
  assert.ok(match.includes('exhaustive: 0 is not boxed to Number'))
  assert.ok(read("docs/design/vips/0007-match.md").includes("generic and refined subject domains"))
  assert.ok(read("docs/user/src/vibelang-features/116-match-and-is.md").includes('A type parameter with a finite constraint is checked over that constraint'))
  const result = run(block(match, "const genericCoverageExit") + `
import assert from "node:assert/strict"
assert.equal(genericCoverageExit._tag, "Success")
assert.deepEqual(genericCoverageExit.value, [1, 2, 1, 2, 1])
assert.equal(openCoverageExit._tag, "Failure")
assert.ok(openCoverageExit.cause.reasons.some(reason => reason._tag === "Die" && reason.defect instanceof TypeError))
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
