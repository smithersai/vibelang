import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { splitPlatform } from "../lib/platform.mjs"

// codemod-gap:platform-split-schema-value-import (drive-t3code-apps
// 2026-11-02T02:42Z): t3code Desktop's MacSettingsWindow.ts declares a schema
// value and a type of the same name, `const Shape = Schema.String` and
// `export type Shape = typeof Shape.Type`. The split took the type for the
// moved code's value read, so the sibling got `import type { Shape }` and used
// it as a value (TS2693), leaving the value behind.

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = require("typescript")
const compiler = process.env.VIBELANG_BINARY

const ambient = `declare module "node:fs" { export function existsSync(path: string): boolean }\n`
// A stand-in for effect/Schema: the split reads names, not Effect's types.
const schema = `export interface Schema<T> { readonly Type: T }
export const String: Schema<string> = { Type: "" }
export const Number: Schema<number> = { Type: 0 }
export function decodeSync<T>(s: Schema<T>): (u: unknown) => T { return (u) => u as T }
`
function emit(files) {
  const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, declaration: true, emitDeclarationOnly: true, allowImportingTsExtensions: true, noUnusedLocals: true, types: [], skipLibCheck: true }
  const all = { "/p/ambient.d.ts": ambient, "/p/package.json": '{"type":"module"}', "/p/Schema.ts": schema, ...Object.fromEntries(Object.entries(files).map(([k, v]) => ["/p/" + k, v])) }
  const host = ts.createCompilerHost(options)
  const read = host.readFile.bind(host), exists = host.fileExists.bind(host)
  host.readFile = (name) => all[name] ?? read(name)
  host.fileExists = (name) => name in all || exists(name)
  host.directoryExists = (dir) => Object.keys(all).some((k) => k.startsWith(dir.replace(/\/?$/, "/"))) || ts.sys.directoryExists(dir)
  host.getCurrentDirectory = () => "/p"
  host.getSourceFile = (name, version) => { const text = host.readFile(name); return text === undefined ? undefined : ts.createSourceFile(name, text, version, true) }
  const out = {}
  host.writeFile = (name, text) => { out[name.replace(/^.*\//, "")] = text }
  const program = ts.createProgram(Object.keys(all).filter((k) => k.endsWith(".ts")), { ...options, outDir: "/out" }, host)
  program.emit()
  const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error).map((d) => `${d.file?.fileName ?? ""}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`)
  return { out, errors }
}

// drive-t3code-apps' minimized MacSettingsWindow.ts.
const macSettings = readFileSync(new URL("./corpus/t3code-platform-schema-value.ts", import.meta.url), "utf8")

test("t3code Desktop MacSettingsWindow: a moved value read takes the value, and the split refuses because the exported type reads it", () => {
  assert.deepEqual(emit({ "main.ts": macSettings }).errors, [])
  const result = splitPlatform(macSettings, "main.ts", ts)
  assert.equal(result.refused, "main.ts: the type Shape reads the value Shape, which main.platform.ts would take, so the module's declarations would change")
})

test("t3code Desktop MacSettingsWindow: the refused module compiles natively as written", { skip: !compiler && "set VIBELANG_BINARY" }, () => {
  const root = mkdtempSync(join(tmpdir(), "platform-schema-value-"))
  try {
    writeFileSync(join(root, "Schema.ts"), schema)
    writeFileSync(join(root, "node.d.ts"), ambient)
    writeFileSync(join(root, "main.ts"), macSettings)
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler", noEmit: true, allowImportingTsExtensions: true, skipLibCheck: true }, include: ["*.ts", "*.vibe"] }))
    const result = spawnSync(compiler, ["-p", "tsconfig.json", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8" })
    assert.equal(result.status, 0, result.stdout + result.stderr)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// Modules with a same-name value and type, `X`, whose moved function reads X
// as a value, as a type, both or neither, and whose type reads the value or
// not. Either the split refuses with the named reason, exactly when a kept
// type reads a moved value, or the program checks and the module's
// declaration is stock TypeScript's declaration of the original.
test("a same-name value and type split by how the moved code reads them, keeping declarations", () => {
  let split = 0, refused = 0
  const shape = fc.record({
    typeReadsValue: fc.boolean(),
    typeExported: fc.boolean(),
    valueExported: fc.boolean(),
    movedValueRead: fc.boolean(),
    movedTypeRead: fc.boolean(),
    keptValueRead: fc.boolean(),
    schema: fc.constantFrom("String", "Number"),
  })
  fc.assert(fc.property(shape, (s) => {
    const T = s.schema === "String" ? "string" : "number"
    const lines = ['import { existsSync } from "node:fs";', 'import * as Schema from "./Schema.ts";']
    lines.push(`${s.valueExported ? "export " : ""}const X = Schema.${s.schema};`)
    lines.push(`${s.typeExported ? "export " : ""}type X = ${s.typeReadsValue ? "typeof X.Type" : T};`)
    const ret = s.movedTypeRead ? "X" : T
    const body = s.movedValueRead ? `existsSync(path); return Schema.decodeSync(X)(path);` : `existsSync(path); return path as unknown as ${ret};`
    lines.push(`export function read(path: string): ${ret} { ${body} }`)
    // Keep every private declaration read, so noUnusedLocals stays quiet.
    lines.push(`export const kept = (u: unknown): ${s.typeExported || !s.movedTypeRead ? "X" : T} => ${s.keptValueRead || !s.valueExported ? "Schema.decodeSync(X)(u) as never" : "u as never"};`)
    const text = lines.join("\n") + "\n"
    const before = emit({ "m.ts": text })
    assert.deepEqual(before.errors, [], text)
    const result = splitPlatform(text, "m.ts", ts)
    assert.ok(result, text)
    // The moved code takes X's value exactly when it reads it, and the type X stays, so that split is refused.
    // A private type the sibling would copy that reads the value X is refused as before.
    const copiesTypeOfValue = s.movedTypeRead && s.typeReadsValue && !s.typeExported
    assert.equal(Boolean(result.refused), s.movedValueRead || copiesTypeOfValue, (result.refused ?? result.platform) + "\n" + text)
    if (result.refused) {
      const named = s.typeReadsValue ? /the type X reads the value X/ : /the value X would move to m.platform.ts but the type X stays/
      // An exported value is also refused as before, since it is not a function that can stay.
      assert.ok(named.test(result.refused) || (s.valueExported && /export X uses platform code/.test(result.refused)), result.refused)
      refused++
      return
    }
    // A type-only read imports the module's exported type or copies a private one, as before.
    const after = emit({ "m.ts": result.module, "m.platform.ts": result.platform })
    assert.deepEqual(after.errors, [], text + "\n----\n" + result.module + "\n----\n" + result.platform)
    assert.equal(after.out["m.d.ts"], before.out["m.d.ts"], result.module)
    split++
  }), { seed: 2026110208, numRuns: 80 })
  assert.ok(split > 10 && refused > 5, `split ${split}, refused ${refused}`)
})
