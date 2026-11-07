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
