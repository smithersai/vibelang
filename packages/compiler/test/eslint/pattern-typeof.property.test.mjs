import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { Linter } from "eslint"
import parser from "../../eslint.mjs"

const corpus = JSON.parse(readFileSync(new URL("../property-regressions/opencode-match-generated-typeof.json", import.meta.url)))
const config = [{
  files: ["**/*.{vibe,vibex}"],
  languageOptions: { parser },
  rules: { "no-restricted-syntax": ["error", { selector: "UnaryExpression[operator='typeof']", message: "Use the parsed domain value." }] }
}]
test("a runtime typeof policy ignores record pattern guards and reports only authored typeof", () => {
  const lint = source => new Linter({ cwd: "/" }).verify(source, config, { filename: new URL("./probe.vibe", import.meta.url).pathname })
  assert.deepEqual(lint(corpus.source), [])
  const source = corpus.source.replace("ready.version", 'typeof ready.version')
  const messages = lint(source)
  assert.equal(messages.length, 1)
  assert.equal(messages[0].ruleId, "no-restricted-syntax")
  assert.equal(messages[0].nodeType, "UnaryExpression")
  assert.deepEqual([messages[0].line, messages[0].column], [4, 45])
})
