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

test("source lint visits primitive-spelled matcher references without generated typeof operators", () => {
  for (const matcher of ["String", "Number", "Boolean", "BigInt", "Symbol"]) {
    const rules = {
      "no-restricted-syntax": ["error",
        { selector: "UnaryExpression[operator='typeof']", message: "generated operator" },
        { selector: "Identifier[name='" + matcher + "']", message: "authored matcher" }
      ]
    }
    for (const extension of ["vibe", "vibex"]) for (const isExpression of [false, true]) {
      for (const local of [false, true]) {
        const parameters = "subject" + (local ? ", " + matcher : "")
        const pattern = matcher + "(let value)"
        const source = "// café 😀\nexport function f(" + parameters + ") { " + (isExpression
          ? "if (subject is " + pattern + ") return value; return null;"
          : "return match (subject) { when " + pattern + ": value; default: null; }") + " }"
        const messages = new Linter({ cwd: "/" }).verify(source, [{ ...config[0], rules }], {
          filename: new URL("./probe." + extension, import.meta.url).pathname
        })
        assert.equal(messages.length, local ? 2 : 1, source)
        for (const message of messages) {
          assert.equal(message.ruleId, "no-restricted-syntax", source)
          assert.equal(message.message, "authored matcher", source)
          assert.equal(message.nodeType, "Identifier", source)
        }
      }
    }
  }
})
