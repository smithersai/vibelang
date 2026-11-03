import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { Linter } from "eslint"
import vibelang from "../../eslint.mjs"
import { walk } from "./tree.mjs"
import { reportsSynthesizedConstant } from "./tree.mjs"

const filename = new URL("./condition.vibe", import.meta.url).pathname
function lint(code, mutate = () => {}) {
  const linter = new Linter({ configType: "flat", cwd: "/" })
  const parser = { ...vibelang, parseForESLint(text, options) {
    const parsed = vibelang.parseForESLint(text, options)
    walk(parsed.ast, (node) => { if (node.type === "IfStatement") mutate(node.test) }, parsed.visitorKeys)
    return parsed
  } }
  const messages = linter.verify(code, [{ files: ["**/*.vibe"], languageOptions: { parser }, rules: { "no-constant-condition": "error" } }], { filename })
  assert.equal(messages.length, 1, JSON.stringify(messages) + "\n" + code)
  assert.equal(messages[0].ruleId, "no-constant-condition")
  return reportsSynthesizedConstant(messages[0], linter.getSourceCode())
}

test("the real rule still reports source literals and the corpus accepts only their source provenance", () => {
  for (const raw of ["true", "false", "0", "1n", "0xF", "\"yes\"", "null", "/yes/u"]) {
    const code = "/* 😀 */\r\nif ((" + raw + ")) { void 1 }"
    assert.equal(lint(code), false)
    assert.equal(lint(code, (node) => { node.synthesized = true }), true)
    assert.equal(lint(code, (node) => { node.raw = "notWritten" }), true)
  }
  assert.equal(lint("function f() { const v = do { found: { if (true) break found; 1 } 2 }; return v }"), false)
  assert.equal(lint("if (true || x) { void 1 }"), true, "unclassified expressions must remain visible")
})

test("real ESLint literal reports survive generated trivia, values and provenance mutations", () => {
  fc.assert(fc.property(
    fc.constantFrom("", "// condition\n", "/* 😀 */\r\n", "\uFEFF\t", "/* é */\u2028"),
    fc.oneof(fc.boolean().map(String), fc.nat(100_000).map(String), fc.nat(100_000).map((n) => "0x" + n.toString(16)),
      fc.nat(100_000).map((n) => n + "n"), fc.constantFrom("\"yes\"", "\"\"", "\"\\u0079es\"", "null", "/yes/u")),
    (prefix, raw) => {
      const code = prefix + "if ((" + raw + ")) { void 1 }"
      assert.equal(lint(code), false, code)
      assert.equal(lint(code, (node) => { node.synthesized = true }), true)
      assert.equal(lint(code, (node) => { node.raw = "notWritten" }), true)
    }
  ), { seed: 102, numRuns: 100 })
})
