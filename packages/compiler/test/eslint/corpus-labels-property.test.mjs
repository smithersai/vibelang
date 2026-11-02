import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { Linter } from "eslint"
import vibelang from "../../eslint.mjs"
import { reportsSynthesizedLabel } from "./tree.mjs"

const filename = new URL("./oracle.vibe", import.meta.url).pathname
const config = [{ files: ["**/*.vibe"], languageOptions: { parser: vibelang }, rules: { "no-unused-labels": "error" } }]
const forms = [
  (name) => name + ": { void 1 }",
  (name) => name + ": for (let i = 0; i < 1; i++) {}",
  (name) => "export function f() { " + name + ": { return 1 } }"
]

test("real label diagnostics keep source provenance across generated names and syntax", () => {
  fc.assert(fc.property(
    fc.constantFrom("label", "ChangedUrl", "outer", "$label", "éclair"),
    fc.integer({ min: 0, max: 9999 }),
    fc.integer({ min: 0, max: forms.length - 1 }),
    fc.constantFrom("", "// 😀\n", "/* adjacent */\r\n", "\uFEFF\t"),
    (base, suffix, form, prefix) => {
      const name = base + suffix
      const linter = new Linter({ configType: "flat", cwd: "/" })
      const messages = linter.verify(prefix + forms[form](name), config, { filename })
      assert.equal(messages.length, 1, JSON.stringify(messages))
      const message = messages[0]
      assert.equal(message.ruleId, "no-unused-labels")
      const source = linter.getSourceCode()
      assert.equal(reportsSynthesizedLabel(message, source), false)
      const index = source.getIndexFromLoc({ line: message.line, column: message.column - 1 })
      const node = source.getNodeByRangeIndex(index)
      assert.equal(node.name, name)
      node.synthesized = true
      assert.equal(reportsSynthesizedLabel(message, source), true)
      delete node.synthesized
      assert.equal(reportsSynthesizedLabel({ ...message, message: message.message.replaceAll(name, "notWritten") }, source), true)
    }
  ), { seed: 101, numRuns: 80 })
})
