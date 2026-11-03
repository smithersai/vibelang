import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { Linter } from "eslint"
import vibelang from "../../eslint.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
import { callInputs, doCallInputs, sourceCallRule } from "../eslint-source-calls.mjs"

test("real ESLint retains genuine ASI warnings across generated source call forms", async () => {
  await checkProperty(fc, {
    name: "eslint-source-call-asi", rule: sourceCallRule,
    command: "node --test packages/compiler/test/eslint/source-calls-property.test.mjs",
    // Scope analysis accepts TypeScript too; the parser chooses by extension.
    arbitrary: callInputs(fc), regressions: new URL("../corpus/", import.meta.url), numRuns: 120,
    check: ({ code, filePath, warnings }) => {
      const filename = new URL("." + filePath, import.meta.url).pathname
      const messages = new Linter({ configType: "flat", cwd: "/" }).verify(code, [{
        files: ["**/*.vibe", "**/*.ts"], languageOptions: { parser: vibelang }, rules: { "no-unexpected-multiline": "error" }
      }], { filename })
      assert.equal(messages.length, warnings, "source call ASI diagnostics\n" + code + "\n" + JSON.stringify(messages))
      for (const message of messages) {
        assert.equal(message.fatal, undefined)
        assert.equal(message.ruleId, "no-unexpected-multiline")
        const lines = code.split(/\r\n|[\r\n\u2028\u2029]/u)
        assert.equal(lines[message.line - 1][message.column - 1], "(")
      }
    }, artifacts: ({ code, filePath }) => ({ [filePath.endsWith(".ts") ? "main.ts" : "main.vibe"]: code })
  })
})

function lint(code) {
  return new Linter({ configType: "flat", cwd: "/" }).verify(code, [{
    files: ["**/*.vibe"], languageOptions: { parser: vibelang }, rules: { "no-unexpected-multiline": "error" }
  }], { filename: new URL("./source-call.vibe", import.meta.url).pathname })
}

test("the minimized do witness has no synthetic ASI reports", () => {
  const { input } = JSON.parse(readFileSync(new URL("../corpus/eslint-do-method-call-asi.json", import.meta.url), "utf8"))
  assert.deepEqual(lint(input.code), [])
})

test("real ESLint reports exactly the written call newline around lowered do", () => {
  fc.assert(fc.property(doCallInputs(fc), ({ code, warnings }) => {
    const messages = lint(code)
    assert.equal(messages.length, warnings, JSON.stringify(messages) + "\n" + code)
    for (const message of messages) {
      assert.equal(message.fatal, undefined)
      assert.equal(message.ruleId, "no-unexpected-multiline")
      assert.equal(message.nodeType, "Identifier")
      const lines = code.split(/\r\n|[\r\n\u2028\u2029]/u)
      assert.equal(lines[message.line - 1][message.column - 1], "(")
    }
  }), { seed: 105, numRuns: 160 })
})

test("captured computed calls retain user scope reads and unused declarations", () => {
  const code = `function f(out, key) {
    for (const i of [0, 1]) {
      const unused = 1
      out[key](do { if (i === 0) continue; 0 })
    }
  }
  f({}, "push")
  `
  const messages = new Linter({ configType: "flat", cwd: "/" }).verify(code, [{
    files: ["**/*.vibe"], languageOptions: { parser: vibelang },
    rules: { "no-unused-vars": "error", "no-undef": "error", "no-unexpected-multiline": "error" }
  }], { filename: new URL("./source-call.vibe", import.meta.url).pathname })
  assert.deepEqual(messages.map(({ ruleId, message, fatal }) => ({ ruleId, message, fatal })), [{
    ruleId: "no-unused-vars", message: "'unused' is assigned a value but never used.", fatal: undefined
  }])
})

test("computed-access newlines remain genuine reports after a do capture", () => {
  for (const callGap of ["", "\n"]) {
    const code = "function f() { for (const i of [0, 1]) { out\n[key]" + callGap + "(do { if (i === 0) continue; 0 })\n} }"
    const messages = lint(code)
    assert.deepEqual(messages.map(({ messageId }) => messageId).sort(),
      callGap ? ["function", "property"] : ["property"])
    for (const message of messages) {
      assert.equal(message.fatal, undefined)
      assert.equal(message.ruleId, "no-unexpected-multiline")
      const lines = code.split("\n")
      assert.equal(lines[message.line - 1][message.column - 1], message.messageId === "property" ? "[" : "(")
    }
  }
})

test("the three original do-lowering fixtures have no generated ASI reports", () => {
  for (const name of ["do-jump-operand-order", "do-call-argument", "do-lowering-effect-order"]) {
    const code = readFileSync(new URL("../../../../typescript/vibelang/cases/" + name + "/main.vibe", import.meta.url), "utf8")
    assert.deepEqual(lint(code), [], name)
  }
})
