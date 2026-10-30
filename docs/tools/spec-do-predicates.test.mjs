import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

const receipt = () => read("docs/design/vips/tc39-do-expressions/README.md")
test("the do predicate has an explicit empty-switch base case in every adopted account", () => {
  assert.doesNotMatch(receipt(), /VibeLang adds nothing to the proposal/);
  for (const text of [receipt(), chapter("002-running"), chapter("900-appendices")]) {
    assert.match(text, /CaseBlock : \{ \}/)
    assert.match(text, /either value of `isLast`/)
    assert.match(text, /any `labelSet`/)
  }
})

test("every added iteration form inherits the native predicate and both other classifications", () => {
  for (const text of [receipt(), chapter("002-running"), chapter("900-appendices")]) {
    assert.match(text, /ForTry/)
    assert.match(text, /ForConcurrent/)
    assert.match(text, /IsBreak/)
    assert.match(text, /same `labelSet` and `isLast`/)
    assert.match(text, /`IsEmpty` and `IsBreak`.*`false`/)
  }
  const snapshot = read("docs/design/vips/tc39-do-expressions/spec.emu")
  assert.match(snapshot, /If _isLast_ is \*true\*, return \*true\*\./)
  assert.match(snapshot, /Return EndsInIterationOrBareIfOrDeclaration of \|Statement\| with arguments _labelSet_ and _isLast_/)
})

test("the exact printed counterparts preserve empty-switch completion and nonfinal loop values", () => {
  const result = run(block(chapter("002-running"), "// Do static-predicate controls"))
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), [7, true, 7, 7])
})

test("VIP-2 publishes the complete adopted do static predicates", () => {
  const vip = read("docs/design/vips/0002-effect-blocks-and-do.md")
  for (const rule of ["CaseBlock : { }", "ForTry", "ForConcurrent", "same `labelSet` and `isLast`"]) assert.ok(vip.includes(rule), rule)
  assert.match(vip, /static predicates/)
  assert.match(vip, /static-predicate-reconciliations/)
})
