import assert from "node:assert/strict"
import { test } from "node:test"
import { chapter, read } from "./spec-witness.mjs"

// Loop round 3, OPUS-2 (decided detail 245): the nearest enclosing block of
// an unbraced loop body is outside the loop, which would reinitialize one cell
// per iteration, so the body is its own home.
const bodyRule = "when it is not a Block, is the home of the bindings inside it, exactly as if it were wrapped in braces"

test("chapter 4, VIP-7 and the pinned reconciliation give an unbraced body its own home", () => {
  const match = chapter("004-match")
  assert.ok(match.includes(bodyRule))
  assert.ok(match.includes("so braces around a body never change a result (decided detail 245)"))
  assert.ok(match.includes("An `if` head belongs to the home that contains the `if` statement"))
  assert.ok(match.includes("for (const x of xs) if (x is { id: let id }) out.push(id)"))
  assert.ok(!match.includes("nearest enclosing lexical block"))
  assert.ok(!match.includes("nearest-block scope"))
  const vip = read("docs/design/vips/0007-match.md")
  assert.ok(vip.includes("**Amended 2026-10-31: unbraced statement bodies.**"))
  assert.ok(read("docs/design/vips/tc39-pattern-matching/README.md").includes("| Lexical `is` in unbraced statement bodies |"))
  assert.ok(read("docs/user/src/vibelang-features/116-match-and-is.md").includes("An unbraced loop or `if` body counts as its own block"))
})

test("every statement form the rule lists is a statement ECMAScript forbids let in", () => {
  const rule = chapter("004-match").split("\n").find(line => line.includes(bodyRule)) ?? ""
  for (const form of ["`if`", "`else`", "`for`", "`for…in`", "`for…of`", "`for await`", "`for concurrent`", "`for try`", "`while`", "`do…while`", "a labeled statement"]) {
    assert.ok(rule.includes(form), form)
  }
  for (const source of ["for (const x of []) let n = 1", "if (true) let n = 1", "while (false) let n = 1", "l: let n = 1"]) {
    assert.throws(() => new Function(source), SyntaxError, source)
  }
})
