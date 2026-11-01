import assert from "node:assert/strict"
import { test } from "node:test"
import { chapter } from "./spec-witness.mjs"

// Loop round 1, ASTRA-10: decided detail 212 allocates EK0510 to an
// unparenthesized unary execution expression on the left of `**`. Chapter 2's
// try rules and Appendix B state it, in code order.
// Loop round 4, OPUS-7: Appendix A gives every execution head a UnaryExpression
// operand (Await operations, Fork and join), so the rule names all ten.
const heads = "`try`, `try.all`, `try.race`, `try.any`, `try.allSettled`, `fork`, `fork.in(s)`, `fork.scoped`, `fork.detached` or `join`"
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

test("EK0510 is published in chapter 2 and Appendix B", () => {
  assert.ok(chapter("002-running").includes("| an unparenthesized " + heads + " expression on the left of `**`: `try a ** b`, `fork.scoped e ** 2`, as ECMAScript rejects `await a ** b`; write `(try a) ** b` | `EK0510` |"))
  const appendix = chapter("900-appendices")
  assert.match(appendix, new RegExp(escape("| `EK0510` | an unparenthesized " + heads + " expression on the left of `**`") + ".*\\| 5, 17, 18 \\|"))
  const at = (code) => appendix.indexOf(`| \`${code}\` |`)
  assert.ok(at("EK0509") < at("EK0510"), "Appendix B keeps code order")
})

test("EK0510 names every execution head Appendix A gives a UnaryExpression operand", () => {
  const appendix = chapter("900-appendices")
  const production = (name) => appendix.match(new RegExp("```text\n(" + name + " = [\\s\\S]*?)```"))[1]
  const fork = [...production("ForkExpression").matchAll(/"fork"(?: "\." "(\w+)")?/g)].map(m => m[1] ? `fork.${m[1]}` : "fork")
  const tryAll = production("TryAll").match(/\(("[\w"| ]+)\)/)[1].split("|").map(n => "try." + n.trim().replaceAll('"', ""))
  assert.match(production("ForkOperand"), /ForkOperand = UnaryExpression/)
  assert.match(production("JoinExpression"), /"join" ForkOperand/)
  const grammar = ["try", ...tryAll, ...fork, "join"].map(h => h === "fork.in" ? "fork.in(s)" : h)
  const listed = [...heads.matchAll(/`([^`]+)`/g)].map(m => m[1])
  assert.deepEqual(listed, grammar)
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
