import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

test("empty arrays have one nullable-list derivation and identifier keys stay admitted", () => {
  const appendix = chapter("900-appendices")
  assert.ok(appendix.includes('ArrayPattern = "[" MatchList "]"'))
  assert.equal((appendix.match(/^ArrayPattern =/gm) || []).length, 1)
  assert.ok(!appendix.includes('ArrayPattern = "[" MatchList?'))
  const match = chapter("004-match")
  assert.ok(match.includes("does not adopt the draft's disputed early error"))
  assert.ok(match.includes("the separate `__proto__` pattern-key restriction"))
  const result = run(block(match, "const emptyPatternExit") + `
import assert from "node:assert/strict"
assert.equal(emptyPatternExit._tag, "Success")
assert.deepEqual(emptyPatternExit.value, ["empty", "empty", "not empty"])
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test("regex literals have exactly the bare and nullable extractor branches", () => {
  const appendix = chapter("900-appendices")
  assert.ok(appendix.includes('RegularExpressionPattern = RegularExpressionLiteral\n                         | RegularExpressionLiteral "(" MatchList ")"'))
  assert.equal((appendix.match(/^RegularExpressionPattern =/gm) || []).length, 1)
  const result = run(block(chapter("004-match"), "const regexPatternExit") + `
import assert from "node:assert/strict"
assert.equal(regexPatternExit._tag, "Success")
assert.deepEqual(regexPatternExit.value, ["1234", "none"])
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test("prefix not is selected by syntax without looking up a binding", () => {
  const match = chapter("004-match")
  assert.ok(match.includes("Prefix `not` wins whenever the same token sequence"))
  assert.ok(match.includes("does not retry that identifier parse to evade an early error"))
  assert.ok(chapter("900-appendices").includes("without consulting bindings"))
  const snapshot = read("docs/design/vips/tc39-pattern-matching/README.md")
  for (const row of ["Object-pattern identifier keys", "Array-pattern grammar", "Contextual `not` ambiguity"]) {
    assert.ok(snapshot.includes("| " + row + " |"))
  }

})
