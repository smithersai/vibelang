import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"
import { withOxlintComments } from "../templates/oxlint-comments.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")

test("reason-only directive adaptation preserves the installed engine's blanket policy", () => {
  fc.assert(fc.property(
    fc.boolean(),
    fc.constantFrom("oxlint", "eslint"),
    fc.constantFrom("disable", "disable-line", "disable-next-line", "enable"),
    fc.constantFrom(" -- justified", " -- café", " -- detailed reason"),
    (blanketReasons, prefix, verb, reason) => {
      const value = " " + prefix + "-" + verb + reason
      const ast = { comments: [{ value }] }
      const parser = { parseForESLint() { return { ast } } }
      const result = withOxlintComments(parser, new Map(), blanketReasons).parseForESLint("")
      assert.equal(result.ast, ast)
      assert.equal(result.ast.comments[0].value, " " + (blanketReasons ? "eslint" : "oxlint") + "-" + verb + reason)
    }
  ), { numRuns: 80 })
})

test("Oxlint nodes, tokens and comments expose source start/end without replacing their identity", () => {
  fc.assert(fc.property(fc.nat(10000), fc.nat(100), (start, length) => {
    const end = start + length
    const comment = { type: "Line", value: " SAFETY: input is checked.", range: [start, end] }
    const token = { type: "Identifier", value: "value", range: [end, end + 5] }
    const node = { type: "Identifier", name: "value", range: [end, end + 5] }
    const ast = { type: "Program", body: [node], comments: [comment], tokens: [token], range: [0, end + 5] }
    const result = withOxlintComments({ parseForESLint: () => ({ ast }) }, new Map()).parseForESLint("")
    assert.equal(result.ast, ast)
    assert.equal(result.ast.body[0], node)
    assert.equal(result.ast.comments[0], comment)
    assert.equal(result.ast.tokens[0], token)
    for (const item of [ast, node, token, comment]) {
      assert.equal(item.start, item.range[0])
      assert.equal(item.end, item.range[1])
    }
  }), { seed: 811084, numRuns: 100 })
})
