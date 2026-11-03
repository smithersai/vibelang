// Stock TypeScript 5.9.3 / Effect 4.1.1 evidence for VIP-15's optional mapping.
// Run after installing experiments: node typescript/vibelang/schema-exact-optional-twins.mjs
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import assert from "node:assert/strict"
const root = path.resolve(import.meta.dirname, "../..")
const require = createRequire(path.join(root, "experiments/package.json"))
const ts = require("typescript")
assert.equal(ts.version, "5.9.3")
assert.equal(require("effect/package.json").version, "4.1.1")
const { Schema } = require("effect")
const output = path.join(root, ".cache/schema-exact-optional-twins")
fs.mkdirSync(output, { recursive: true })
for (const exact of [false, true]) {
  const optional = exact ? "optionalKey" : "optional"
  const source = `import { Data, Schema } from "effect"
export const S = Schema.Struct({
  plain: Schema.mutableKey(Schema.${optional}(Schema.String)),
  loose: Schema.mutableKey(Schema.optional(Schema.Union([Schema.String, Schema.Undefined]))),
  frozen: Schema.${optional}(Schema.String)
})
export type S = typeof S.Type
export class E extends Schema.TaggedError<E>()("E", {
  plain: Schema.${optional}(Schema.String),
  loose: Schema.optional(Schema.Union([Schema.String, Schema.Undefined]))
}) {}
export type D = Data.TaggedEnum<{ Some: { plain?: string; loose?: string | undefined } }>
export const D = Data.taggedEnum<D>()
export const T = Schema.mutable(Schema.Tuple([
  Schema.${optional}(Schema.String),
  Schema.optional(Schema.Union([Schema.Number, Schema.Undefined]))
]))
export type T = typeof T.Type
export type SDecoded = typeof S.Type
export type SEncoded = typeof S.Encoded
export type EDecoded = typeof E.Type
export type EEncoded = typeof E.Encoded
export type DDecoded = D
export type TDecoded = typeof T.Type
export type TEncoded = typeof T.Encoded
const absent: { plain?: string } = {}
${exact ? "// @ts-expect-error exact optional property rejects a present undefined" : ""}
const present: { plain?: string } = { plain: undefined }
${exact ? "// @ts-expect-error exact optional tuple rejects a present undefined" : ""}
const tuple: [string?] = [undefined]
`
  const dir = path.join(output, exact ? "on" : "off")
  fs.mkdirSync(dir, { recursive: true })
  fs.rmSync(path.join(dir, "node_modules"), { force: true, recursive: true })
  fs.symlinkSync(path.join(root, "experiments/node_modules"), path.join(dir, "node_modules"), "dir")
  const file = path.join(dir, "main.ts")
  fs.writeFileSync(file, source)
  const options = { strict: true, exactOptionalPropertyTypes: exact,
    declaration: true, emitDeclarationOnly: true, skipLibCheck: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext }
  const program = ts.createProgram([file], options)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: x => x, getCurrentDirectory: () => dir, getNewLine: () => "\n"
  }))
  program.emit()
  const checker = program.getTypeChecker()
  const types = {}
  for (const node of program.getSourceFile(file).statements) {
    if (ts.isTypeAliasDeclaration(node) && /(?:Decoded|Encoded)$/.test(node.name.text))
      types[node.name.text] = checker.typeToString(checker.getTypeAtLocation(node),
        node, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias)
  }
  const codec = Schema[optional](Schema.String)
  const schemas = [
    Schema.Struct({ plain: Schema.mutableKey(codec) }),
    Schema.TaggedError()("E", { plain: codec }),
    Schema.mutable(Schema.Tuple([codec]))
  ]
  const decode = schemas.map((schema, i) => {
    const samples = i === 2 ? [[], [undefined], ["ok"], [1]] :
      [{}, { plain: undefined }, { plain: "ok" }, { plain: 1 }].map(x => i === 1 ? { _tag: "E", ...x } : x)
    return samples.map(x => Schema.decodeUnknownExit(schema)(x)._tag)
  })
  for (const result of decode) assert.deepEqual(result, ["Success", exact ? "Failure" : "Success", "Success", "Failure"])
  const probeFile = path.join(dir, "probe.ts")
  fs.writeFileSync(probeFile, source.replaceAll(/^\/\/ @ts-expect-error.*\n/gm, ""))
  const rejected = ts.getPreEmitDiagnostics(ts.createProgram([probeFile], options))
    .map(d => ({ code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, "\n") }))
  assert.deepEqual(rejected.map(d => d.code), exact ? [2375, 2322] : [])
  const record = { rejected, typescript: ts.version, effect: "4.1.1", exactOptionalPropertyTypes: exact,
    types, decode, declaration: fs.readFileSync(path.join(dir, "main.d.ts"), "utf8") }
  fs.writeFileSync(path.join(output, exact ? "on.json" : "off.json"), JSON.stringify(record, null, 2) + "\n")
  console.log(JSON.stringify({ exact, rejected, types, decode }))
}
