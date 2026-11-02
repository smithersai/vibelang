import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { Linter } from "eslint"
import vibelang from "../../eslint.mjs"
import { isInputs } from "../eslint-is-calls.mjs"

function lint(code, rules = {}) {
  return new Linter({ configType: "flat", cwd: "/" }).verify(code, [{
    files: ["**/*.vibe"], languageOptions: { parser: vibelang },
    rules: { "no-unexpected-multiline": "error", ...rules }
  }], { filename: new URL("./is.vibe", import.meta.url).pathname })
}

test("is matcher calls introduce no ASI warnings while written calls still report", () => {
  fc.assert(fc.property(isInputs(fc), ({ code, warnings }) => {
    const messages = lint(code)
    assert.equal(messages.length, warnings, JSON.stringify(messages) + "\n" + code)
    for (const message of messages) {
      assert.equal(message.fatal, undefined)
      assert.equal(message.ruleId, "no-unexpected-multiline")
      const lines = code.split(/\r\n|[\r\n\u2028\u2029]/u)
      assert.equal(lines[message.line - 1][message.column - 1], "(")
    }
  }), { seed: 106, numRuns: 160 })
})

test("the minimized is guard corpus has no generated call reports", () => {
  const { input } = JSON.parse(readFileSync(new URL("../corpus/eslint-match-subject-once-is-guard.json", import.meta.url), "utf8"))
  assert.deepEqual(lint(input.code), [])
})

test("is subjects and guard reads retain ordinary scope diagnostics", () => {
  const code = "function f(read, guard, flag) { const unused = 1; return read() is if (guard(flag))\n}\nf(() => 1, x => x, true)"
  const messages = lint(code, { "no-unused-vars": "error", "no-undef": "error" })
  assert.deepEqual(messages.map(({ ruleId, message }) => ({ ruleId, message })), [
    { ruleId: "no-unused-vars", message: "'unused' is assigned a value but never used." }
  ])
})

test("written arrow calls keep their own genuine ASI reports", () => {
  const messages = lint("const result = (($is1) => $is1)\n(1); void result")
  assert.equal(messages.length, 1)
  assert.equal(messages[0].ruleId, "no-unexpected-multiline")
  assert.equal(messages[0].nodeType, "ArrowFunctionExpression")
  assert.equal(messages[0].line, 2)
  assert.equal(messages[0].column, 1)
})

test("the four original captured-pattern fixtures have no generated ASI reports", () => {
  for (const name of ["match-subject-once", "match-unused-names", "tsforms-schemas", "tsforms-schemas-fixed"]) {
    const code = readFileSync(new URL("../../../../typescript/vibelang/cases/" + name + "/main.vibe", import.meta.url), "utf8")
    assert.deepEqual(lint(code), [], name)
  }
})
