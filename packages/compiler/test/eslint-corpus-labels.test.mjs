import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import fc from "fast-check"
import { parseESTree } from "../eslint.mjs"
import { synthesizedLabelAtNode, walk } from "./eslint/tree.mjs"

function check(code, name) {
  const ast = parseESTree(code, "/oracle.vibe")
  let label
  walk(ast, (node) => {
    if (node.type === "LabeledStatement" && node.label.name === name) label ??= node.label
  }, {})
  assert.ok(label, code)
  const message = { message: "'" + name + ":' is defined but never used." }
  assert.equal(synthesizedLabelAtNode(message, label), false, code)
  assert.equal(synthesizedLabelAtNode(message, { ...label, synthesized: true }), true)
  assert.equal(synthesizedLabelAtNode(message, { ...label, name: "notWritten" }), true)
  assert.equal(synthesizedLabelAtNode(message, undefined), true)
}

test("source-label oracle keeps labels written in blocks, loops and functions", () => {
  for (const name of ["label", "ChangedUrl", "outer", "$label", "éclair"]) {
    check(name + ": { void 1 }", name)
    check("export function f() { " + name + ": for (let i = 0; i < 1; i++) {} }", name)
  }
  check("lab" + "\\u0065" + "l: { void 1 }", "label")
  check(readFileSync(new URL("./eslint/corpus/foldkit-website-labeled-arrow.vibe", import.meta.url), "utf8"), "ChangedUrl")
  assert.equal(synthesizedLabelAtNode({ message: "unknown future label diagnostic" }, undefined), true)
})

test("generated source labels never excuse synthetic or unwritten label mutations", () => {
  fc.assert(fc.property(
    fc.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"), { minLength: 1, maxLength: 16 }),
    fc.constantFrom("", "// 😀\n", "/* adjacent */\r\n", "\uFEFF\t"),
    (letters, prefix) => {
      const name = "label_" + letters.join("")
      check(prefix + name + ": { void 1 }", name)
    }
  ), { seed: 101, numRuns: 80 })
})
