import assert from "node:assert/strict"
import { test } from "node:test"
import { chapter } from "./spec-witness.mjs"

// Loop round 1, ASTRA-10: decided detail 212 allocates EK0510 to an
// unparenthesized unary execution expression on the left of `**`. Chapter 2's
// try rules and Appendix B state it, in code order.
test("EK0510 is published in chapter 2 and Appendix B", () => {
  assert.match(chapter("002-running"), /\| an unparenthesized `try`, `fork` or `join` expression on the left of `\*\*`: `try a \*\* b`, as ECMAScript rejects `await a \*\* b`; write `\(try a\) \*\* b` \| `EK0510` \|/)
  const appendix = chapter("900-appendices")
  assert.match(appendix, /\| `EK0510` \| an unparenthesized `try`, `fork` or `join` expression on the left of `\*\*`/)
  const at = (code) => appendix.indexOf(`| \`${code}\` |`)
  assert.ok(at("EK0509") < at("EK0510"), "Appendix B keeps code order")
})

// The rule's ECMAScript model: ExponentiationExpression's left operand is an
// UpdateExpression, so a unary operator there is a SyntaxError unless
// parenthesized. The spec cites `await a ** b`, which ECMA-262 rejects the same
// way (V8 does; JavaScriptCore accepts it), so the check uses unary minus,
// which every engine rejects.
test("ECMAScript rejects an unparenthesized unary operand on the left of **", () => {
  assert.throws(() => new Function("return -2 ** 2"), SyntaxError)
  assert.equal(new Function("return (-2) ** 2")(), 4)
})
