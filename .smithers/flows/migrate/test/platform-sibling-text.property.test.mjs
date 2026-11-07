import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { platformPath, splitPlatform } from "../lib/platform.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = require("typescript")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-platform-sibling-text.json", import.meta.url), "utf8"))

const ambient = `declare module "node:fs" { export function readFileSync(path: string): string }
declare module "node:crypto" { export function createHash(algorithm: string): { update(data: string): { digest(encoding: "hex"): string } } }
declare module "node:path" { export function resolve(...paths: string[]): string }
`

// Stock TypeScript's declaration of each file and the errors of the program, from in-memory files.
function emit(files, extra = "") {
  const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, declaration: true, emitDeclarationOnly: true, allowImportingTsExtensions: true, noUnusedLocals: true, types: [], skipLibCheck: true }
  const all = { "/p/ambient.d.ts": ambient + extra, "/p/package.json": '{"type":"module"}', ...Object.fromEntries(Object.entries(files).map(([k, v]) => ["/p/" + k, v])) }
  const host = ts.createCompilerHost(options)
  const read = host.readFile.bind(host)
  const exists = host.fileExists.bind(host)
  host.readFile = (name) => all[name] ?? read(name)
  host.fileExists = (name) => name in all || exists(name)
  host.directoryExists = (dir) => Object.keys(all).some((k) => k.startsWith(dir.replace(/\/?$/, "/"))) || ts.sys.directoryExists(dir)
  host.getCurrentDirectory = () => "/p"
  host.getSourceFile = (name, version) => {
    const text = host.readFile(name)
    return text === undefined ? undefined : ts.createSourceFile(name, text, version, true)
  }
  const out = {}
  host.writeFile = (name, text) => { out[name.replace(/^.*\//, "")] = text }
  const program = ts.createProgram(Object.keys(all).filter((k) => k.endsWith(".ts")), { ...options, outDir: "/out" }, host)
  program.emit()
  const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error).map((d) => `${d.file?.fileName ?? ""}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`)
  return { out, errors }
}

const exported = (statement) => (ts.getModifiers?.(statement) ?? statement.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
const nameOf = (statement) => statement.name?.text ?? statement.declarationList?.declarations[0]?.name.text

// The split never edits a declaration it moves: each one the sibling holds is
// the original's text, or a copied exported type's text without `export`, and
// the sibling adds exports only as export lists.
function assertMovedAsWritten(original, sibling) {
  const before = ts.createSourceFile("m.ts", original, ts.ScriptTarget.Latest, true)
  const after = ts.createSourceFile("m.platform.ts", sibling, ts.ScriptTarget.Latest, true)
  for (const statement of after.statements) {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) continue
    const name = nameOf(statement)
    const source = before.statements.find((s) => !ts.isImportDeclaration(s) && nameOf(s) === name && (s.getText() === statement.getText() || s.getText() === "export " + statement.getText()))
    assert.ok(source, `${name}: the sibling's text is not the original's\n${statement.getText()}\n----\n${sibling}`)
    assert.ok(!exported(statement) || exported(source), `${name}: the sibling exports a declaration the module kept private\n${sibling}`)
  }
}

// Smithers' JSDoc convention, as its root lint reads a file: a module header
// block with `@since`, a blank line from the first statement, and a JSDoc
// block with `@since` on every exported declaration (an export list is not one).
function smithersConvention(text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const problems = []
  const first = source.statements[0]
  const leading = text.slice(0, first ? first.getStart(source) : text.length)
  const blocks = [...leading.matchAll(/\/\*\*[\s\S]*?\*\//g)]
  // The first block before the first statement that is not an export's
  // (one with @category), which must carry @since and a blank line after it.
  const header = blocks.find((m) => /^\s*\*\s*@module\b/m.test(m[0]) || !/^\s*\*\s*@category\b/m.test(m[0]))
  if (!header || !/^\s*\*\s*@since\b/m.test(header[0]) || !/^[ \t]*\r?\n[ \t]*\r?\n/.test(leading.slice(header.index + header[0].length))) problems.push(`${file}: Every module needs a header block above the first statement: prose, then @since`)
  for (const statement of source.statements) {
    if (!exported(statement) || ts.isExportDeclaration(statement)) continue
    const docs = ts.getJSDocCommentsAndTags(statement.declarationList?.declarations[0] ?? statement)
    if (!docs.some((d) => /@since/.test(d.getFullText(source)))) problems.push(`${file}: Missing JSDoc comment on ${nameOf(statement)}`)
  }
  return problems
}

test("smithers: a sibling keeps the module's header and its private helpers as written", () => {
  for (const { file, text, globals, ambient: extra } of corpus.modules) {
    assert.deepEqual(smithersConvention(text, file), [], `${file}: the original meets the convention`)
    const split = splitPlatform(text, file, ts, { globals })
    assert.ok(split && !split.refused, `${file}: ${split?.refused}`)
    const sibling = platformPath(file)
    assert.deepEqual(smithersConvention(split.platform, sibling), [], split.platform)
    assertMovedAsWritten(text, split.platform)
    const before = emit({ [file]: text }, extra)
    const after = emit({ [file]: split.module, [sibling]: split.platform }, extra)
    assert.deepEqual(before.errors, [], file)
    assert.deepEqual(after.errors, [], split.module + "\n----\n" + split.platform)
    assert.equal(after.out[file.replace(/\.ts$/, ".d.ts")], before.out[file.replace(/\.ts$/, ".d.ts")], split.module)
  }
})

const headers = [
  ["none", ""],
  ["module documentation", "/**\n * Reads the store.\n *\n * @since 1.0.0\n */\n\n"],
  ["license", "// Copyright the authors.\n// SPDX-License-Identifier: MIT\n\n"],
  ["shebang and documentation", "#!/usr/bin/env node\n/**\n * A tool.\n *\n * @since 0.1.0\n */\n\n"],
  ["directive and documentation", '/// <reference lib="es2022" />\n/**\n * A client.\n *\n * @since 1.0.0\n */\n\n'],
  ["directive alone", "// @effect-diagnostics nodeBuiltinImport:off\n\n"],
  ["documentation of the first import", "/** Reads files. */\n"]
]

test("splitPlatform starts the sibling with the module's header and moves private helpers as written", () => {
  const callee = fc.constantFrom('readFileSync("x")', 'resolve("a", "b")', 'createHash("sha256").update("v").digest("hex")', "String(1)", "helper0(s)")
  const fn = fc.record({ exported: fc.boolean(), body: callee, arrow: fc.boolean(), doc: fc.boolean() })
  fc.assert(fc.property(fc.constantFrom(...headers), fc.array(fn, { minLength: 1, maxLength: 6 }), ([, header], fns) => {
    const lines = ['import { readFileSync } from "node:fs"', 'import { resolve } from "node:path"', 'import { createHash } from "node:crypto"', ""]
    const used = new Set()
    fns.forEach((f, i) => {
      const name = (f.exported ? "fn" : "helper") + i
      const body = f.body === "helper0(s)" && (i === 0 || fns[0].exported) ? "String(s)" : f.body
      for (const m of ["readFileSync", "resolve", "createHash", "helper0"]) if (body.includes(m + "(")) used.add(m)
      const doc = f.doc ? `/**\n * Doc of ${name}.\n *\n * @since 1.0.0\n */\n` : ""
      const exp = f.exported ? "export " : ""
      lines.push(doc + (f.arrow ? `${exp}const ${name} = (s: string): string => ${body} + s` : `${exp}function ${name}(s: string): string {\n  return ${body} + s\n}`))
    })
    if (!fns.some((f) => f.exported)) lines.push("export const kept = 1")
    lines.push(`export const all = (s: string): string => [${fns.map((f, i) => (f.exported ? "fn" : "helper") + i + "(s)").join(", ")}].join("")`)
    for (const [m, line] of [["readFileSync", 'import { readFileSync } from "node:fs"'], ["resolve", 'import { resolve } from "node:path"'], ["createHash", 'import { createHash } from "node:crypto"']]) {
      if (!used.has(m)) lines.splice(lines.indexOf(line), 1)
    }
    if (!lines[0]) lines.shift()
    const text = header + lines.join("\n") + "\n"
    const before = emit({ "m.ts": text })
    fc.pre(before.errors.length === 0)
    const result = splitPlatform(text, "m.ts", ts)
    if (result === null) return
    assert.ok(!result.refused, result.refused)
    const after = emit({ "m.ts": result.module, "m.platform.ts": result.platform })
    assert.deepEqual(after.errors, [], result.module + "\n----\n" + result.platform)
    assert.equal(after.out["m.d.ts"], before.out["m.d.ts"], result.module)
    assertMovedAsWritten(text, result.platform)
    // A header is the comments a blank line separates from the first
    // statement; the sibling starts with it, without the shebang, once.
    const detached = header.endsWith("\n\n") ? header.replace(/^#!.*\n/, "").trimEnd() : ""
    if (detached) assert.ok(result.platform.startsWith(detached + "\n"), result.platform)
    for (const line of detached.split("\n").filter((l) => l.startsWith("//"))) assert.equal(result.platform.split(line).length - 1, 1, result.platform)
    assert.ok(!result.platform.startsWith("#!"), result.platform)
  }), { seed: 85085, numRuns: 120 })
})
