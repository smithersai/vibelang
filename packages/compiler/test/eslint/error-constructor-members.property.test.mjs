import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { Linter } from "eslint"
import vibelang, { parseForESLint } from "../../eslint.mjs"
import { problems } from "./tree.mjs"

const filename = new URL("./fixtures/error-source.vibe", import.meta.url).pathname
function lint(code) {
  return new Linter({ configType: "flat", cwd: "/" }).verify(code, [{
    files: ["**/*.vibe"], languageOptions: { parser: vibelang },
    rules: { "no-unused-vars": "error", "no-undef": "error" }
  }], { filename })
}

test("constructor payload corpus keeps its field, getter and source names", () => {
  const { input } = JSON.parse(readFileSync(new URL("../corpus/eslint-error-constructor-payload-methods.json", import.meta.url), "utf8"))
  const { ast, visitorKeys } = parseForESLint(input.code, { filePath: filename })
  assert.deepEqual(problems(input.code, ast, visitorKeys), [])
  const declaration = ast.body[0].declaration
  assert.deepEqual(declaration.body.body.map((node) => [node.type, node.key.name]), [
    ["PropertyDefinition", "constructor"], ["MethodDefinition", "label"]
  ])
  assert.deepEqual(lint(input.code), [])
})

test("plain error methods survive payload spelling, trivia and Unicode source offsets", () => {
  fc.assert(fc.property(
    fc.constantFrom("constructor", "code", "$code", "état"),
    fc.constantFrom("label", "$label", "Δείγμα"),
    fc.constantFrom("\n", "\r\n"),
    fc.boolean(), fc.boolean(),
    (field, name, newline, optional, getter) => {
      const code = "// 😀 source offsets" + newline + "export error Failure {" + newline +
        "  " + field + (optional ? "?" : "") + ": string;" + newline +
        "  /* source method */ " + (getter ? "get " : "") + name + "() { return this." + field + " }" + newline + "}"
      const { ast, visitorKeys } = parseForESLint(code, { filePath: filename })
      assert.deepEqual(problems(code, ast, visitorKeys), [], code)
      const body = ast.body[0].declaration.body
      assert.equal(code.slice(...body.range)[0], "{")
      assert.equal(code.slice(...body.range).at(-1), "}")
      assert.deepEqual(body.body.map((node) => [node.type, node.key.name]), [
        ["PropertyDefinition", field], ["MethodDefinition", name]
      ])
      assert.equal(body.body[1].kind, getter ? "get" : "method")
      assert.deepEqual(lint(code), [], code)
    }
  ), { seed: 175, numRuns: 160 })
})

test("retained methods still expose an authored unused parameter", () => {
  const code = "export error Failure { constructor: string; label(unused: string) { return this.constructor } }"
  const messages = lint(code)
  assert.equal(messages.length, 1, JSON.stringify(messages))
  assert.equal(messages[0].ruleId, "no-unused-vars")
  assert.match(messages[0].message, /'unused' is defined but never used/u)
  assert.equal(messages[0].column, code.indexOf("unused") + 1)
})
