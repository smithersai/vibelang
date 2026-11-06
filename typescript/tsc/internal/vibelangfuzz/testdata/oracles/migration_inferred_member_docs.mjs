import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { pathToFileURL } from "node:url"

const root = process.cwd(), require = createRequire(join(root, "packages/runtime/package.json"))
const ts = require("typescript")
const { recordDeclarationSurface, compareDeclarations } = await import(pathToFileURL(join(root, ".smithers/flows/migrate/lib/declarations.mjs")))
const [key, rawMode] = process.argv.slice(2), mode = Number(rawMode) & 7
assert.ok(["inferred-move", "typed-move", "reexport-all", "mutate-doc", "no-doc"].includes(key))
const doc = mode & 4 ? "Read normalized text." : "Read decoded bytes."
const comment = key === "no-doc" ? "" : "/** " + doc + " */ "
const factory = mode & 1 && key !== "no-doc"
  ? "export const make = () => ({\n  " + comment.trimEnd() + '\n  read: () => "data"\n});\n'
  : "export const make = () => ({ " + comment + 'read: () => "data" });\n'
const api = "export const api" + (key === "typed-move" ? ": ReturnType<typeof make>" : "") + " = make();\n"
let original = factory + api + "export const pure = 1;\n"
if (key === "inferred-move" && (mode === 0 || mode === 1)) {
  const name = mode === 0 ? "opencode-inferred-member-docs-inline-control.ts" : "opencode-inferred-member-docs.ts"
  const corpus = readFileSync(join(root, "typescript/tsc/internal/vibelangfuzz/testdata/corpus", name), "utf8")
  assert.equal(corpus, original)
  original = corpus
}
const after = key === "reexport-all"
  ? { "helper.ts": factory + api, "index.ts": 'export { make, api } from "./helper.js";\nexport const pure = 1;\n' }
  : key === "mutate-doc"
    ? { "index.ts": original.replaceAll(doc, "Changed public documentation.") }
    : { "helper.ts": factory, "index.ts": 'import { make } from "./helper.js";\nexport { make } from "./helper.js";\n' + api + "export const pure = 1;\n" }
const normalize = text => mode & 2 ? text.replaceAll("\n", "\r\n") : text
mkdirSync(join(root, ".cache"), { recursive: true })
const temp = mkdtempSync(join(root, ".cache/member-docs-"))
function emit(name, files) {
  const pkg = join(temp, name), snapshot = join(temp, name + "-declarations")
  mkdirSync(pkg, { recursive: true }); mkdirSync(snapshot)
  writeFileSync(join(pkg, "package.json"), JSON.stringify({
    name: "@fixture/member-docs", type: "module", exports: { ".": { types: "./lib/index.d.ts" } }
  }))
  writeFileSync(join(pkg, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler",
      types: [], declaration: true, emitDeclarationOnly: true, rootDir: "src", outDir: "lib" },
    include: ["src"]
  }))
  for (const [file, text] of Object.entries(files)) {
    const path = join(pkg, "src", file)
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, normalize(text))
  }
  const config = ts.readConfigFile(join(pkg, "tsconfig.json"), ts.sys.readFile)
  assert.equal(config.error, undefined)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, pkg)
  assert.deepEqual(parsed.errors, [])
  const host = ts.createCompilerHost(parsed.options), write = host.writeFile.bind(host)
  host.writeFile = (file, text, ...rest) => {
    mkdirSync(dirname(file), { recursive: true }); write(file, text, ...rest)
    if (file.endsWith(".d.ts")) {
      const path = join(snapshot, relative(join(pkg, "lib"), file))
      mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text)
    }
  }
  const program = ts.createProgram(parsed.fileNames, parsed.options, host)
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [])
  assert.equal(program.emit().emitSkipped, false)
  recordDeclarationSurface(ts, snapshot, pkg, [{ tsconfig: "tsconfig.json", prefix: "." }])
  return snapshot
}
function memberDocs(snapshot) {
  const file = join(snapshot, "index.d.ts")
  const program = ts.createProgram([file], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, types: [] })
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [])
  const source = program.getSourceFile(file), checker = program.getTypeChecker()
  const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(source))
  const exportedType = name => {
    let symbol = exports.find(item => item.name === name)
    assert.ok(symbol)
    if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
    return checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? symbol.declarations[0])
  }
  const docOf = type => {
    const read = type.getProperty("read")
    assert.ok(read, "the public read member remains present")
    return ts.displayPartsToString(read.getDocumentationComment(checker))
  }
  const make = exportedType("make").getCallSignatures()
  assert.equal(make.length, 1)
  return { "api.read": docOf(exportedType("api")), "make.return.read": docOf(make[0].getReturnType()) }

}
try {
  const before = emit("before", { "index.ts": original }), current = emit("after", after)
  const beforeDocs = memberDocs(before), afterDocs = memberDocs(current)
  if (mode & 1 && key !== "no-doc") assert.ok(Object.values(beforeDocs).includes(doc), "multiline source must expose public member documentation")
  const self = compareDeclarations(ts, before, before)
  assert.equal(self.comparisonComplete, true)
  assert.equal(self.identical, true)
  const comparison = compareDeclarations(ts, before, current)
  assert.equal(comparison.comparisonComplete, true, JSON.stringify(comparison.environmentDiagnostics))
  assert.deepEqual(comparison.nameDifferences, [])
  assert.deepEqual(comparison.typeDifferences, [])
  const expectedIdentity = JSON.stringify(beforeDocs) === JSON.stringify(afterDocs)
  const docReports = comparison.docDifferences.length
  console.log(JSON.stringify({
    ok: comparison.identical === expectedIdentity && (expectedIdentity ? docReports === 0 : docReports > 0),
    key, beforeDocs, afterDocs, expectedIdentity, identical: comparison.identical, docReports, comparisonComplete: comparison.comparisonComplete
  }))
} finally { rmSync(temp, { recursive: true, force: true }) }
