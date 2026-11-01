import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import ts from "typescript"

const require = createRequire(new URL("../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const document = process.env.VIBELANG_VIP8_DOC
  ? readFileSync(process.env.VIBELANG_VIP8_DOC, "utf8")
  : readFileSync(new URL("../design/vips/0008-using-denied.md", import.meta.url), "utf8")

// VIP-8 denies special Effect resource syntax: native using retains native
// lexical ownership. This guard checks the printed example's acquisition
// structure; runtime equivalence stays in FuzzVIPDifferential.
function pair(text) {
  text = text.replaceAll("\r\n", "\n")
  const example = text.split("## What was proposed")[0]
  assert.match(example, /using.*keeps exactly TypeScript's meaning/)
  assert.match(example, /\*\*Status:\*\* denied/)
  const fenced = example.match(new RegExp(String.fromCharCode(96).repeat(3) + "ts\\n([\\s\\S]*?)" + String.fromCharCode(96).repeat(3)))
  assert.ok(fenced, "native-resource example")
  const parts = fenced[1].split("// Effect TS")
  assert.equal(parts.length, 2)
  const resourceLines = parts[0].split("\n").filter(line => /^\s*using\s/.test(line))
  assert.ok(resourceLines.length > 0, "the witness still acquires a native resource")
  const parse = code => {
    const file = ts.createSourceFile("witness.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    assert.deepEqual(file.parseDiagnostics, [])
    return file
  }
  const original = parse(resourceLines.join("\n"))
  const ref = parse(parts[1])
  const resources = (file, statements = file.statements) => statements.filter(ts.isVariableStatement)
    .filter(node => (node.declarationList.flags & ts.NodeFlags.Using) === ts.NodeFlags.Using)
    .flatMap(node => node.declarationList.declarations.map(declaration => ({
      name: declaration.name.getText(file),
      initializer: ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Expression, declaration.initializer, file),
    })))
  const binding = ref.statements.find(ts.isVariableStatement)?.declarationList.declarations[0]
  assert.ok(binding && ts.isArrowFunction(binding.initializer), "the shown load factory")
  const call = binding.initializer.body
  assert.ok(ts.isCallExpression(call) && call.expression.getText(ref) === "Effect.gen",
    "the native resource belongs to the outer generator, before Effect.scoped")
  const outer = call.arguments[0]
  assert.ok(ts.isFunctionExpression(outer) && outer.asteriskToken)
  assert.deepEqual(resources(ref, outer.body.statements), resources(original),
    "the counterpart must retain each native acquisition in its original lexical owner")
  assert.ok(outer.body.statements.some(node => ts.isReturnStatement(node) && node.expression &&
    ts.isYieldExpression(node.expression) && node.expression.asteriskToken &&
    ts.isCallExpression(node.expression.expression) && node.expression.expression.expression.getText(ref) === "Effect.scoped"),
    "the outer generator returns the inner scoped Effect")
}

test("r9 ASTRA-2: the denied using VIP retains native acquisition in its counterpart", () => pair(document))

test("native resource ownership survives identifier, argument and trivia neighbourhoods", () => {
  fc.assert(fc.property(fc.record({
    suffix: fc.integer({ min: 0, max: 999 }),
    argument: fc.constantFrom("p", "undefined", "p + 1", "{ path: p }"),
    newline: fc.constantFrom("\n", "\r\n"),
    comment: fc.constantFrom("", "/*native*/ ", "/*using is not Effect syntax*/ "),
  }), ({ suffix, argument, newline, comment }) => {
    const variant = document.replace(/\bf\b/g, "resource" + suffix)
      .replaceAll("openFile(p)", "openFile(" + argument + ")")
      .replaceAll("using resource", "using " + comment + "resource")
      .replaceAll("\n", newline)
    pair(variant)
  }), { seed: 9008, numRuns: 200 })
})
