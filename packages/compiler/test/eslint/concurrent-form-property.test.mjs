import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { Linter } from "eslint"
import vibelang from "../../eslint.mjs"
import { concurrentInputs } from "../eslint-concurrent-form.mjs"

function lint(code, rules = {}) {
  return new Linter({ configType: "flat", cwd: "/" }).verify(code, [{
    files: ["**/*.vibe"], languageOptions: { parser: vibelang },
    rules: { "no-unexpected-multiline": "error", ...rules }
  }], { filename: new URL("./concurrent.vibe", import.meta.url).pathname })
}

test("concurrent heads never invent calls and written calls retain ASI reports", () => {
  fc.assert(fc.property(concurrentInputs(fc), ({ code, warnings }) => {
    const messages = lint(code)
    assert.equal(messages.length, warnings, JSON.stringify(messages) + "\n" + code)
    for (const message of messages) {
      assert.equal(message.fatal, undefined)
      assert.equal(message.ruleId, "no-unexpected-multiline")
      const lines = code.split(/\r\n|[\r\n\u2028\u2029]/u)
      assert.equal(lines[message.line - 1][message.column - 1], "(")
    }
  }), { seed: 107, numRuns: 160 })
})

test("the minimized concurrent-head corpus has no synthetic ASI report", () => {
  const { input } = JSON.parse(readFileSync(new URL("../corpus/eslint-concurrent-head-newline.json", import.meta.url), "utf8"))
  assert.deepEqual(lint(input.code), [])
})

test("the original concurrent-head-newline fixture has zero false warnings", () => {
  const code = readFileSync(new URL("../../../../typescript/vibelang/cases/concurrent-head-newline/main.vibe", import.meta.url), "utf8")
  assert.deepEqual(lint(code), [])
})

test("concurrent limits, iterables and item bindings keep source scope reads", () => {
  const code = "effect function f(items, use, limit) { for concurrent(limit(1)) (const x of items(1)) { const unused = 1; use(x) } }\nf(x => [x], x => x, x => x)"
  assert.deepEqual(lint(code, { "no-unused-vars": "error", "no-undef": "error" }).map(({ ruleId, message }) => ({ ruleId, message })), [
    { ruleId: "no-unused-vars", message: "'unused' is assigned a value but never used." }
  ])
})

test("a written same-named callee retains its genuine call warning", () => {
  const messages = lint("const $forConcurrent = (...args) => args; $forConcurrent\n(1, 2, 3)")
  assert.equal(messages.length, 1)
  assert.equal(messages[0].ruleId, "no-unexpected-multiline")
  assert.equal(messages[0].nodeType, "Identifier")
})
