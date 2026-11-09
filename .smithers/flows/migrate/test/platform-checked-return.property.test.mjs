// The platform split refused every factory with an inferred return type once
// its moved code read a private type of the module, since only the sibling
// would declare that type and the return type might name it (opencode app
// session/timeline/virtualizer, gui-plugins browser/chromium, app
// session/composer/queue). The sibling now exports such a type, and
// splitBatchPlatform retries the split with a type checker over the module's
// tsconfig: an export whose return type provably names none of those types
// keeps its wrapper and the sibling exports none. A return type that names
// one, directly or through a property, a method parameter, a type argument or
// a returned closure, or that contains an `any` the checker cannot see
// through, names the sibling's export (opencode gui-plugins browser/pane).
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { loadTypeScript } from "../lib/declarations.mjs"
import { platformPath, splitBatchPlatform } from "../lib/platform.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const ts = loadTypeScript([runtime])
const fc = createRequire(join(runtime, "package.json"))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-platform-split-checked-return.json", import.meta.url), "utf8"))
const quote = "Explicit editor refactors preserve evaluation order, coldness, types, comments and declaration output."
const ambient = "declare function setTimeout(handler: () => void, ms?: number): number\n"
const config = { compilerOptions: { strict: true, noUnusedLocals: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler", lib: ["ES2022"], types: [], noEmit: true, allowImportingTsExtensions: true }, include: ["*.ts"] }

// Stock TypeScript over a directory's files, with declarations: the errors,
// and each export of entry as a fully qualified type.
function check(root, entry) {
  const options = { ...ts.convertCompilerOptionsFromJson(config.compilerOptions, root).options, noEmit: false, declaration: true, emitDeclarationOnly: true, outDir: join(root, ".out") }
  const files = ts.sys.readDirectory(root, [".ts"], [".out"]).filter((f) => !f.includes("/.out/"))
  const program = ts.createProgram(files, options)
  const emitted = program.emit()
  const errors = [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics].filter((d) => d.category === ts.DiagnosticCategory.Error).map((d) => `${d.file ? d.file.fileName.slice(root.length + 1) : ""} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`)
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(join(root, entry))
  const flags = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType
  const types = {}
  for (const symbol of checker.getExportsOfModule(checker.getSymbolAtLocation(source))) {
    const type = symbol.flags & ts.SymbolFlags.Value ? checker.getTypeOfSymbolAtLocation(symbol, source) : checker.getDeclaredTypeOfSymbol(symbol)
    // A private type the sibling exports prints through import("./m.platform").
    types[symbol.name] = checker.typeToString(type, undefined, flags).replaceAll(root, "<root>").replaceAll(`import("<root>/${entry.replace(/\.ts$/, "")}.platform").`, "").replaceAll(`import("<root>/${entry.replace(/\.ts$/, "")}").`, "")
  }
  return { errors, types }
}

// Writes the module into a fresh project and runs the batch split over it.
// Returns whether it split and which private types the sibling exports; a
// split compiles and keeps every export's type.
function splitInProject(file, text, globals = ["setTimeout"], extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-checked-"))
  try {
    for (const [name, content] of Object.entries({ "tsconfig.json": JSON.stringify(config), "ambient.d.ts": ambient, ...extra, [file]: text })) {
      mkdirSync(join(root, dirname(name)), { recursive: true })
      writeFileSync(join(root, name), content)
    }
    const before = check(root, file)
    assert.deepEqual(before.errors, [], "the original compiles:\n" + text)
    const result = splitBatchPlatform(root, [file], ts, { globalsOf: () => globals })
    if (!result.splits.length) return { split: false, refused: result.refused.join("\n") }
    const after = check(root, file)
    const written = readFileSync(join(root, file), "utf8") + "\n---\n" + readFileSync(join(root, platformPath(file)), "utf8")
    assert.deepEqual(after.errors, [], written)
    assert.deepEqual(after.types, before.types, written)
    return { split: true, exported: result.splits[0].exportedForInference ?? [] }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("the split quotes the accepted repair contract", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(quote))
})

test("opencode: a factory whose return type names no private type keeps its wrapper, and one that names it exports it from the sibling", () => {
  for (const { file, text, split } of corpus.modules) {
    const result = splitInProject(file, text)
    assert.equal(result.split, true, file + ": " + result.refused)
    // `split` is the corpus's checked answer: the return type names no private type.
    assert.equal(result.exported.length === 0, split, file + ": " + result.exported)
  }
})

test("an any the checker cannot see through exports the private type from the sibling", () => {
  const text = 'import { make } from "./missing.ts"\n\ntype Row = { readonly id: string }\n\nexport function createRows() {\n  const rows: Row[] = []\n  setTimeout(() => {}, 1)\n  return { rows: () => rows.length, handle: make() }\n}\n'
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-checked-"))
  try {
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify(config))
    writeFileSync(join(root, "ambient.d.ts"), ambient)
    writeFileSync(join(root, "rows.ts"), text)
    const result = splitBatchPlatform(root, ["rows.ts"], ts, { globalsOf: () => ["setTimeout"] })
    assert.equal(result.splits.length, 1, JSON.stringify(result))
    assert.deepEqual(result.splits[0].exportedForInference, ["Row"])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// Neighbourhood: a factory, as a function declaration or a const arrow, whose
// moved body reads a private type Projection, and whose return type uses it
// not at all or through a property, a method parameter, an array, a Promise
// argument or a returned closure. The split always keeps the module's types,
// and the sibling exports Projection exactly when the return type names it.
test("a checked factory exports the private type exactly when its return type names it", () => {
  const uses = {
    none: ["{ size: () => count, first: () => project(0).index }", false],
    property: ["{ size: () => count, first: project(0) }", true],
    parameter: ["{ size: () => count, has(p: Projection) { return p.index < project(count).index } }", true],
    array: ["{ size: () => count, all: [project(0)] }", true],
    promise: ["{ size: () => count, later: Promise.resolve(project(0)) }", true],
    closure: ["{ size: () => count, at: (i: number) => project(i) }", true],
  }
  fc.assert(fc.property(fc.constantFrom(...Object.keys(uses)), fc.boolean(), fc.boolean(), (use, declared, exportedOther) => {
    const [value, exposes] = uses[use]
    const body = `{\n  const project = (index: number): Projection => ({ index })\n  setTimeout(() => {}, 1)\n  return ${value}\n}`
    const fn = declared ? `export function createVirtualizer(count: number) ${body}\n` : `export const createVirtualizer = (count: number) => ${body}\n`
    const other = exportedOther ? "export type Size = { readonly size: number }\n" : ""
    const result = splitInProject("m.ts", `type Projection = { readonly index: number }\n${other}\n${fn}`)
    assert.equal(result.split, true, `${use}: ${result.refused}`)
    assert.deepEqual(result.exported, exposes ? ["Projection"] : [], use)
  }), { numRuns: 30 })
})
