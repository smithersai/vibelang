import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"
import { forms, probe } from "../../../scripts/resolution-matrix.mjs"

const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
const fc = require("fast-check"), ts = require("typescript")
const modes = ["node10", "node16", "nodenext", "bundler"]

test("shared tsc host captures each emitted declaration without changing default matrix rows", () => {
  let cells = 0
  for (const mode of modes) for (const allow of [false, true]) for (const rewrite of [false, true])
    for (const packageType of ["module", "commonjs"]) for (const form of forms) {
      const plain = probe(mode, allow, rewrite, form, packageType, true)
      const captured = probe(mode, allow, rewrite, form, packageType, true, { captureDeclarations: true })
      const { declarations, ...row } = captured
      assert.deepEqual(row, plain)
      assert.equal(typeof declarations?.["main.d.ts"], "string", captured.key)
      assert.ok(Object.keys(declarations).some(name => name !== "main.d.ts"), captured.key)
      cells++
    }
  assert.equal(cells, 448)
})

test("property: shared tsc declaration capture preserves export forms, types and public comments", () => {
  fc.assert(fc.property(fc.record({
    mode: fc.constantFrom(...modes), allow: fc.boolean(), rewrite: fc.boolean(),
    packageType: fc.constantFrom("module", "commonjs"),
    formIndex: fc.integer({ min: 0, max: forms.length - 1 }),
    syntax: fc.constantFrom("named", "star", "alias", "type"), single: fc.boolean(),
    doc: fc.constantFrom("A public value.", "Stable declaration documentation.", "First line.\n * Second line."),
    shape: fc.constantFrom("number", "string", "{ readonly id: number }"),
  }), input => {
    const form = forms[input.formIndex], quote = input.single ? "'" : '"'
    const written = quote + form[1] + quote
    const source = {
      named: `export { value } from ${written};\n`,
      star: `export * from ${written};\n`,
      alias: `export { value as publicValue } from ${written};\n`,
      type: `export type Value = typeof import(${written}).value;\n`,
    }[input.syntax]
    const initializer = { number: "1", string: '"ok"', "{ readonly id: number }": "{ id: 1 }" }[input.shape]
    const targetSource = `/** ${input.doc} */\nexport const value: ${input.shape} = ${initializer};\n`
    const captured = probe(input.mode, input.allow, input.rewrite, form, input.packageType, true,
      { captureDeclarations: true, source, targetSource })
    const declarations = captured.declarations
    assert.equal(typeof declarations?.["main.d.ts"], "string", captured.key)
    assert.ok(declarations["main.d.ts"].includes(written), declarations["main.d.ts"])
    assert.deepEqual(captured.emitted, [form[1]])
    const target = Object.entries(declarations).find(([name]) => name !== "main.d.ts")?.[1]
    assert.ok(target?.includes(input.doc), target)
    const file = ts.createSourceFile("target.d.ts", target, ts.ScriptTarget.Latest, true)
    const value = file.statements.filter(ts.isVariableStatement)
      .flatMap(statement => [...statement.declarationList.declarations]).find(node => node.name.getText(file) === "value")
    assert.ok(value?.type, target)
    if (input.shape.startsWith("{")) {
      assert.ok(ts.isTypeLiteralNode(value.type), target)
      const member = value.type.members.find(node => ts.isPropertySignature(node) && node.name.getText(file) === "id")
      assert.equal(member?.type?.kind, ts.SyntaxKind.NumberKeyword)
      assert.ok(member.modifiers.some(node => node.kind === ts.SyntaxKind.ReadonlyKeyword))
    } else assert.equal(value.type.kind, input.shape === "number" ? ts.SyntaxKind.NumberKeyword : ts.SyntaxKind.StringKeyword)
  }), { seed: 263, numRuns: 96 })
})
