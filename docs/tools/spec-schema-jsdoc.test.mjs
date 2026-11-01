import assert from "node:assert/strict"
import test from "node:test"
import ts from "typescript"
import { chapter, read, tools } from "./spec-witness.mjs"
import { join } from "node:path"

test("schema declaration documentation belongs to its constant", () => {
  assert.ok(chapter("006-data").includes("A JSDoc comment on a `schema` declaration is emitted on its `declare const` only"))
  assert.ok(chapter("006-data").includes("its `typeof Name.Type` alias has no comment"))
  assert.ok(read("docs/design/vips/0027-declaration-output.md").includes("documented schemas"))
})

test("native Effect pairs retain documentation and visibility on the constant", { timeout: 60000 }, () => {
  const docs = ["", "/** Wire message. */", "/** First line.\n * Second line.\n */",
    "/** @internal */", "/** @public */", "/** @deprecated Use another schema. */",
    "/** Wire message.\n * @public\n * @deprecated Use another schema.\n */", "// ordinary comment"]
  const source = 'import * as Schema from "effect/Schema"\n' + docs.map((doc, i) =>
    doc + "\nexport const S" + i + ' = Schema.Struct({ id: Schema.String })\n' +
    "export type S" + i + " = typeof S" + i + ".Type\n").join("\n")
  const file = join(tools, "__schema_jsdoc_control.ts")
  for (const removeComments of [false, true]) for (const stripInternal of [false, true]) {
    const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, skipLibCheck: true,
      types: [], declaration: true, emitDeclarationOnly: true, removeComments, stripInternal }
    const host = ts.createCompilerHost(options)
    const original = host.getSourceFile.bind(host)
    host.getSourceFile = (name, ...args) => name === file
      ? ts.createSourceFile(file, source, options.target, true) : original(name, ...args)
    let output = ""
    host.writeFile = (name, text) => { if (name.endsWith(".d.ts")) output = text }
    const program = ts.createProgram([file], options, host)
    assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [])
    assert.equal(program.emit().emitSkipped, false)
    for (let i = 0; i < docs.length; i++) {
      assert.ok(output.includes("export type S" + i + " = typeof S" + i + ".Type;"))
      assert.equal(output.includes("export declare const S" + i + ":"), !(stripInternal && i === 3))
    }
    assert.equal((output.match(/Wire message/g) || []).length, removeComments ? 0 : 2)
    assert.equal((output.match(/@deprecated/g) || []).length, removeComments ? 0 : 2)
    assert.doesNotMatch(output, /\*\/\s*export type/)
    assert.doesNotMatch(output, /ordinary comment/)
  }
})
