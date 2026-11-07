import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {test} from "node:test"
import fc from "fast-check"
import {Linter} from "eslint"
import parser from "../../eslint.mjs"
import {walk} from "./tree.mjs"
import {checkProperty} from "../../../../scripts/testing/property.mjs"

const rule = "linters, Knip, bundlers and test runners each read `.vibe`"
const filename = new URL("./scope-input.vibe", import.meta.url).pathname
function check({code, constName = null}) {
  const linter = new Linter({configType: "flat", cwd: "/"})
  const messages = linter.verify(code, [{
    files: ["**/*.vibe"], languageOptions: {parser},
    rules: {"prefer-const": "error", "no-const-assign": "error", "no-undef": "error", "no-unused-vars": "error"}
  }], {filename})
  assert.deepEqual(messages.map(({ruleId, message}) => ({ruleId, message})), constName === null ? [] : [{
    ruleId: "prefer-const", message: "'" + constName + "' is never reassigned. Use 'const' instead."
  }], code)
  const source = linter.getSourceCode()
  const synthetic = (v) => v.identifiers.length > 0 && v.identifiers.every((n) => n.synthesized === true)
  assert.deepEqual(source.scopeManager.scopes.flatMap((s) => s.variables).filter(synthetic), [])
  const declarations = new Set()
  walk(source.ast, (node) => {
    for (const variable of source.getDeclaredVariables(node)) declarations.add(variable)
  }, source.visitorKeys)
  assert.deepEqual([...declarations].filter(synthetic), [], "declaration queries expose only authored variables")
  if (constName !== null) assert.ok([...declarations].some((v) => v.name === constName), "the authored declaration remains queryable")
}
const inputs = fc.record({
  name: fc.constantFrom("result", "$do1", "$do2", "$do_t1", "$match1", "é", "Σ"),
  kind: fc.constantFrom("const", "let"),
  writeLater: fc.boolean(),
  shape: fc.constantFrom("argument", "element", "call", "delete", "plain", "conditional"),
  prefix: fc.constantFrom("", "// before\n", "/* 😀 */\r\n", "/* é */\u2028"),
  value: fc.integer({min: -9, max: 9})
}).map(({name, kind, writeLater, shape, prefix, value}) => {
  const body = "do { " + value + " }"
  const expression = {
    argument: "receiver?.f(" + body + ")",
    element: "receiver?.[do { 'value' }]",
    call: "receiver?.(" + body + ")",
    delete: "delete receiver?.[do { 'value' }]",
    plain: body,
    conditional: "receiver ? " + body + " : do { 0 }"
  }[shape]
  const writes = kind === "let" && writeLater
  return {
    code: prefix + "export function run(receiver) { void receiver; " + kind + " " + name + " = " + expression + "; " +
      (writes ? name + " = 2; " : "") + "return " + name + " }",
    constName: kind === "let" && !writes ? name : null
  }
})

test("optional do declarations do not leak generated prefer-const reports", () => {
  check(JSON.parse(readFileSync(new URL("../corpus/eslint-optional-do-scope.json", import.meta.url), "utf8")).input)
})

test("scope lists and declaration queries agree across generated do neighbourhoods", async () => {
  await checkProperty(fc, {
    name: "eslint-synthetic-declarations", rule,
    command: "node --test packages/compiler/test/eslint/synthetic-declarations.property.test.mjs",
    arbitrary: inputs, regressions: new URL("../corpus/", import.meta.url), numRuns: 160,
    check, artifacts: ({code}) => ({"main.vibe": code})
  })
})

test("authored dollar bindings keep real constant and reassignment diagnostics", () => {
  check({code: "export function run(receiver) { let $do1 = receiver?.f(do { 1 }); return $do1 }", constName: "$do1"})
  check({code: "export function run(receiver) { let $do1 = receiver?.f(do { 1 }); $do1 = 2; return $do1 }"})
  const linter = new Linter({configType: "flat", cwd: "/"})
  const messages = linter.verify("export const real = do { 1 }; real = 2", [{
    files: ["**/*.vibe"], languageOptions: {parser}, rules: {"no-const-assign": "error"}
  }], {filename})
  assert.deepEqual(messages.map(({ruleId, message}) => ({ruleId, message})), [{ruleId: "no-const-assign", message: "'real' is constant."}])
})

test("the scope projection oracle quotes the current tooling specification", () => {
  assert.ok(readFileSync(new URL("../../../../docs/design/vips/0034-compiler-and-tooling.md", import.meta.url), "utf8").includes(rule))
})

test("automatic const fixes leave generated temporaries alone and still fix authored dollar bindings", () => {
  const code = JSON.parse(readFileSync(new URL("../corpus/eslint-optional-do-scope.json", import.meta.url), "utf8")).input.code
  const config = [{files: ["**/*.vibe"], languageOptions: {parser}, rules: {"prefer-const": "error"}}]
  const run = (text) => new Linter({configType: "flat", cwd: "/"}).verifyAndFix(text, config, {filename})
  const unchanged = run(code)
  assert.equal(unchanged.fixed, false)
  assert.equal(unchanged.output, code)
  assert.deepEqual(unchanged.messages, [])
  const authored = "export function run(receiver) { let $do1 = receiver?.f(do { 1 }); return $do1 }"
  const fixed = run(authored)
  assert.equal(fixed.fixed, true)
  assert.equal(fixed.output, authored.replace("let $do1", "const $do1"))
  assert.deepEqual(fixed.messages, [])
})
