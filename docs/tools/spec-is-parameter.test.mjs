import assert from "node:assert/strict"
import test from "node:test"
import { lexer } from "marked"
import { block, chapter, read, run } from "./spec-witness.mjs"

test("is bindings require a defined lexical home during parameter initialization", () => {
  const match = chapter("004-match")
  assert.ok(match.includes("## `is` bindings in parameter initialization"))
  assert.ok(match.includes("evaluated computed binding keys"))
  assert.ok(match.includes("Nested source callable bodies keep their own scopes"))
  assert.ok(match.includes("There is no generic move-to-body quick fix"))
  assert.ok(match.includes('function nested({ a = (1 is const captured) } = {})'))
  assert.ok(match.includes('function key({ [(1 is let captured) ? "x" : "y"]'))
  assert.ok(match.includes('function arm(a = match (1)'))
  assert.ok(chapter("001-functions").includes("formal-parameter initialization (`EK0705`)"))
  assert.equal([...chapter("900-appendices").matchAll(/\| `EK0705` \|/g)].length, 1)
  assert.ok(read("docs/design/vips/0007-match.md").includes("formal-parameter binding homes"))
  assert.ok(read("docs/design/vips/tc39-pattern-matching/README.md").includes("lexical `is` bindings in formal-parameter initialization"))
  const reconciliations = lexer(read("docs/design/vips/tc39-pattern-matching/README.md")).filter(token => token.type === "table")
  assert.ok(reconciliations.some(table => table.rows.some(row => row[0].text === "lexical `is` bindings in formal-parameter initialization")), "parameter-home reconciliation must render in its table")
  const result = run(block(match, "const parameterScopeExit") + `
import assert from "node:assert/strict"
assert.equal(parameterScopeExit._tag, "Success")
assert.deepEqual(parameterScopeExit.value, [[true, 1], true, 1, [1, 2]])
assert.deepEqual(defaultEvents, ["default", "later", "body"])
assert.equal(good.length, 0)
assert.equal(reader.length, 1)
assert.equal(readerScopeExit._tag, "Success")
assert.deepEqual(readerScopeExit.value, [2, 101, 3])
defaultEvents.length = 0
assert.deepEqual(eager(9), [9, 2])
assert.deepEqual(defaultEvents, ["later", "body"])
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
