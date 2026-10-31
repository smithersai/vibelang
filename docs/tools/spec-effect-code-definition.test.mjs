import assert from "node:assert/strict"
import { test } from "node:test"
import { chapter } from "./spec-witness.mjs"

const definition = () => chapter("002-running").split("\n").find((line) => line.startsWith("\"Effect code\" means"))
const parses = (source) => {
  try { new Function(source); return true } catch (error) { if (error instanceof SyntaxError) return false; throw error }
}

test("the effect-code definition matches the grammar's Effect parameter", () => {
  const text = definition()
  assert.ok(text, "002 defines effect code")
  // Appendix A: field and enum initializers parse with [~Effect]; parameter lists and static blocks keep the reservation.
  const grammar = chapter("900-appendices")
  assert.ok(grammar.includes("Class field and enum member initializers parse with `[~Effect]`"))
  assert.ok(grammar.includes("permission to execute additionally excludes parameter lists and `static` blocks"))
  assert.doesNotMatch(text, /minus parameter lists, class field initializers/, "field initializers are never parsed with the Effect parameter")
  assert.match(text, /not counting nested functions, class field or enum member initializers or `static` blocks/)
  assert.match(text, /minus parameter lists and `static` blocks, which inherit its reservation without permission to run an Effect; class field and enum member initializers parse without it/)
  assert.doesNotMatch(text, /Outside effect code a parser still parses these constructs[^.]*; tokens that are also valid TypeScript/,
    "parameter lists are outside effect code but still reserve fork and join")
  assert.ok(text.includes("`effect function f(p: Fiber.Fiber<number>, a = join(p)) { }` is `EK1701`"))
})

test("await is reserved in the same positions the definition names", () => {
  // A parameter default and a static block keep the reservation, so the call reading is a SyntaxError.
  assert.equal(parses("return async function f(p, a = await(p)) { }"), false)
  assert.equal(parses("return async function f() { class C { static { await(1) } } }"), false)
  // A class field initializer resets it, as in TypeScript's parser: await is an ordinary identifier there.
  assert.equal(parses("return async function f() { class C { x = await } }"), true)
  assert.equal(parses("return async function f() { return await }"), false)
  // A computed class key keeps the enclosing context and may await.
  assert.equal(parses("return async function f() { class C { [await 1]() { } } }"), true)
})
