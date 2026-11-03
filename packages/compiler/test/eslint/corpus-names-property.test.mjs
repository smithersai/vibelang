import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { Linter } from "eslint"
import tseslint from "typescript-eslint"
import vibelang from "../../eslint.mjs"
import { reportsSynthesizedName } from "./lint-oracle.mjs"

const filename = new URL("./oracle.vibe", import.meta.url).pathname
const config = [{
  files: ["**/*.vibe"], languageOptions: { parser: vibelang },
  plugins: { "@typescript-eslint": tseslint.plugin },
  rules: { "@typescript-eslint/no-unused-vars": "error" }
}]
const forms = [
  (name) => "const " + name + " = 1",
  (name) => "export function f() { const " + name + " = 2; return 1 }",
  (name) => "export function f(" + name + ": number) { return 1 }",
  (name) => 'import { value as ' + name + ' } from "./other.ts"'
]
const prefixes = ["", "// 😀\n", "/* adjacent */\r\n", "\uFEFF\t"]

test("generated user dollar names remain ordinary reports, while synthesized mutations fail", () => {
  fc.assert(fc.property(
    fc.constantFrom("$assertMatch", "$freeze", "$caught", "$match1", "$is", "$noMatch", "$éclair", "$"),
    fc.integer({ min: 0, max: 9999 }),
    fc.integer({ min: 0, max: forms.length - 1 }),
    fc.constantFrom(...prefixes),
    (base, suffix, form, prefix) => {
      const name = base + suffix
      const code = prefix + forms[form](name)
      const linter = new Linter({ configType: "flat", cwd: "/" })
      const messages = linter.verify(code, config, { filename })
      assert.equal(messages.length, 1, JSON.stringify(messages))
      const message = messages[0]
      assert.equal(message.ruleId, "@typescript-eslint/no-unused-vars")
      const source = linter.getSourceCode()
      assert.equal(reportsSynthesizedName(message, source), false, code)
      const index = source.getIndexFromLoc({ line: message.line, column: message.column - 1 })
      const node = source.getNodeByRangeIndex(index)
      assert.equal(node.name, name)
      node.synthesized = true
      assert.equal(reportsSynthesizedName(message, source), true, "must detect an actual synthesized identifier")
      delete node.synthesized
      assert.equal(reportsSynthesizedName({ ...message, message: message.message.replaceAll(name, "$notWritten") }, source), true,
        "another name in the source must not excuse an unwritten helper")
    }
  ), { seed: 100, numRuns: 80 })
})

test("a dollar name elsewhere cannot excuse a report at an unrelated identifier", () => {
  const linter = new Linter({ configType: "flat", cwd: "/" })
  const messages = linter.verify("const ordinary = 1; const $freeze = 2", config, { filename })
  assert.equal(messages.length, 2)
  assert.equal(reportsSynthesizedName({ ...messages[0], message: "'$freeze' is unused." }, linter.getSourceCode()), true)
  assert.equal(reportsSynthesizedName(messages[0], linter.getSourceCode()), false)
})
