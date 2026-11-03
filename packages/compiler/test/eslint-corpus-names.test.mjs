// Native coverage of the corpus name oracle runs without the optional
// ESLint install, even while other standalone corpus findings remain.
import assert from "node:assert/strict"
import fc from "fast-check"
import { test } from "node:test"
import { parseESTree } from "../eslint.mjs"
import { walk } from "./eslint/tree.mjs"
import { synthesizedNameAtNode } from "./eslint/lint-oracle.mjs"

function check(code, name) {
  const ast = parseESTree(code, "/oracle.vibe")
  let identifier
  walk(ast, (node) => {
    if (node.type === "Identifier" && node.name === name && node.synthesized !== true) identifier ??= node
  }, {})
  assert.ok(identifier, code)
  const message = { message: "'" + name + "' is unused." }
  assert.equal(synthesizedNameAtNode(message, identifier), false, code)
  assert.equal(synthesizedNameAtNode(message, { ...identifier, synthesized: true }), true)
  assert.equal(synthesizedNameAtNode(message, { ...identifier, name: "$notWritten" }), true)
  assert.equal(synthesizedNameAtNode(message, undefined), true)
}

test("the corpus name oracle preserves real dollar identifiers and catches synthetic mutations", () => {
  for (const name of ["$assertMatch", "$freeze", "$caught", "$match1", "$", "$éclair"]) {
    check("const " + name + " = 1", name)
    check("export function f(" + name + ": number) { return 1 }", name)
  }
  check("const $fr" + "\\u0065" + "eze = 1", "$freeze")
  assert.equal(synthesizedNameAtNode({ message: "'ordinary' is unused." }, undefined), false)
  assert.equal(synthesizedNameAtNode({ message: "'$not an identifier' is a string." }, undefined), false)
})

test("generated dollar identifiers cannot hide synthesized-name leaks", () => {
  fc.assert(fc.property(
    fc.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"), { minLength: 1, maxLength: 16 }),
    fc.constantFrom("", "// 😀\n", "/* adjacent */\r\n", "\uFEFF\t"),
    (letters, prefix) => {
      const name = "$" + letters.join("")
      check(prefix + "const " + name + " = 1", name)
    }
  ), { seed: 100, numRuns: 80 })
})
