import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { chapter, read } from "./spec-witness.mjs"

// VIP-7's accepted Nov 3 amendment replaces detail245's implicit-body home.
const bodyRule = "when it is not a Block, cannot be the lexical home"
const clauses = [
  bodyRule, "report `EK0705`", "TypeScript's `TS1156`",
  "wraps that statement body in braces",
  "An `if` head belongs to the home that contains the `if` statement",
  "an `else if` head therefore needs braces",
  "an explicit `do` block, match arm, callable body or loop head keeps its own home",
]
function checkBodyRule(text) {
  const line = text.split("\n").find(line => line.includes(bodyRule))
  assert.ok(line, "published unbraced body rule")
  for (const clause of clauses) assert.ok(line.includes(clause), clause)
  return line
}
test("chapter 4, VIP-7, reconciliation and guide require explicit unbraced repairs", () => {
  checkBodyRule(chapter("004-match"))
  checkBodyRule(read("docs/design/vips/0007-match.md"))
  const table = read("docs/design/vips/tc39-pattern-matching/README.md")
  assert.match(table, /Lexical `is` in unbraced statement bodies.*`TS1156`.*`EK0705`.*adds? braces/)
  const guide = read("docs/user/src/vibelang-features/116-match-and-is.md")
  assert.match(guide, /unbraced.*`EK0705`.*braces/)
  assert.doesNotMatch(guide, /unbraced[^.]*own block|adding braces never changes/)
})
test("every listed statement form rejects lexical declarations without braces", () => {
  const rule = checkBodyRule(chapter("004-match"))
  for (const form of ["`if`", "`else`", "`for`", "`for…in`", "`for…of`", "`for await`", "`for concurrent`", "`for try`", "`while`", "`do…while`", "a labeled statement"]) assert.ok(rule.includes(form), form)
  for (const source of ["for (const x of []) let n = 1", "if (true) let n = 1", "while (false) let n = 1", "l: let n = 1"]) assert.throws(() => new Function(source), SyntaxError, source)
})
test("fast-check: native statement bodies reject declarations and accept the brace repair", () => {
  fc.assert(fc.property(fc.constantFrom("for (const x of [])", "if (true)", "while (false)", "label:"), fc.constantFrom(" ", "  ", "\n"), fc.integer({ min: 0, max: 1000 }), (head, space, n) => {
    const declaration = "let value" + n + " = " + n
    assert.throws(() => new Function(head + space + declaration), SyntaxError)
    assert.doesNotThrow(() => new Function(head + space + "{ " + declaration + " }"))
  }), { seed: 1104109, numRuns: 200 })
})
test("fast-check: no ownership or repair clause disappears", () => {
  const text = chapter("004-match")
  fc.assert(fc.property(fc.constantFrom(...clauses), clause => {
    assert.throws(() => checkBodyRule(text.replaceAll(clause, "[removed]")))
  }), { seed: 1104110, numRuns: 160 })
})
