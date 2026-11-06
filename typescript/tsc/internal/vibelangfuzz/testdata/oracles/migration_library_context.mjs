import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, relative } from "node:path"
import { pathToFileURL } from "node:url"

const repo = process.cwd(), require = createRequire(join(repo, "docs/tools/package.json"))
const ts = require("typescript")
const { compareDeclarations, recordDeclarationSurface } = await import(pathToFileURL(join(repo, ".smithers/flows/migrate/lib/declarations.mjs")))
const { compareApiIdentityInWorker } = await import(pathToFileURL(join(repo, "scripts/api-identity.mjs")))
const [key, rawMode] = process.argv.slice(2), mode = Number(rawMode) & 31
assert.ok(["webworker", "worker-dom", "es-dom", "scalar", "changed-type", "unresolved"].includes(key))
const lib = key === "es-dom" ? ["ES2023"] : ["ES2023", "WebWorker"]
if (mode & 4) lib.reverse()
const name = mode & 8 ? "ExecutionContext" : "WorkerContext"
const type = key === "webworker" ? (mode & 16 ? "DedicatedWorkerGlobalScope" : "WorkerGlobalScope")
  : ["worker-dom", "es-dom"].includes(key) ? "Document"
  : key === "unresolved" ? "MissingProjectContext" : "number"
let original = mode & 1 ? `export interface ${name} { readonly context: ${type}; }\n` : `export type ${name} = ${type};\n`
if (key === "webworker" && mode === 0) {
 const corpus = readFileSync(join(repo, "typescript/tsc/internal/vibelangfuzz/testdata/corpus/t3code-api-library-context.vibe"), "utf8")
 assert.equal(original, corpus)
 original = corpus
}
const after = key === "changed-type" ? original.replace("number", "string") : original
const normalize = text => mode & 2 ? text.replaceAll("\n", "\r\n") : text
mkdirSync(join(repo, ".cache"), { recursive: true })
const temp = mkdtempSync(join(repo, ".cache/library-context-"))
const put = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
const stockDiagnostics = []
const started = performance.now()
const stage = name => { if (process.env.LIBRARY_CONTEXT_TRACE) process.stderr.write(JSON.stringify({ stage: name, key, mode, elapsedMs: Math.round(performance.now() - started) }) + "\n") }
function emit(side, text) {
 const pkg = join(temp, side), snapshot = join(temp, side + "-declarations")
 mkdirSync(snapshot, { recursive: true })
 put(join(pkg, "package.json"), JSON.stringify({ name: "@fixture/library-context", type: "module", exports: { ".": { types: "./lib/index.d.ts" } } }))
 put(join(pkg, "src/index.ts"), normalize(text))
 put(join(pkg, "tsconfig.json"), JSON.stringify({ compilerOptions: {
  lib, types: [], strict: true, target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext",
  rootDir: "src", outDir: "lib", declaration: true, emitDeclarationOnly: true
 }, include: ["src"] }))
 const file = join(pkg, "tsconfig.json"), config = ts.readConfigFile(file, ts.sys.readFile)
 assert.equal(config.error, undefined)
 const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, pkg, undefined, file)
 assert.deepEqual(parsed.errors, [])
 const host = ts.createCompilerHost(parsed.options)
 host.writeFile = (file, contents) => {
  assert.ok(file.endsWith(".d.ts"))
  put(join(snapshot, relative(join(pkg, "lib"), file)), contents)
 }
 const program = ts.createProgram(parsed.fileNames, parsed.options, host)
 const diagnostics = ts.getPreEmitDiagnostics(program).map(d => d.code)
 stockDiagnostics.push(...diagnostics)
 const invalid = ["worker-dom", "es-dom", "unresolved"].includes(key)
 assert.deepEqual([...new Set(diagnostics)], invalid ? [2304] : [], "the independent stock source oracle must distinguish missing globals")
 assert.equal(program.emit().emitSkipped, false)
 recordDeclarationSurface(ts, snapshot, pkg, [{ tsconfig: "tsconfig.json", prefix: "." }])
 return { snapshot, options: parsed.options }
}
function frozenTree() {
 const result = {}
 function visit(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
   const path = join(dir, entry.name)
   if (entry.isDirectory()) visit(path)
   else result[relative(temp, path)] = createHash("sha256").update(readFileSync(path)).digest("hex")
  }
 }
 visit(temp)
 return JSON.stringify(result)
}
try {
 stage("source-emit-start")
 const before = emit("before", original), current = emit("after", after)
 stage("source-emit-done")
 // A source rejected before migration cannot establish a migration regression.
 // Retain its original-context rejection as a stock eligibility control.
 const invalidOriginal = ["worker-dom", "es-dom"].includes(key)
 const expectedComplete = !["worker-dom", "es-dom", "unresolved"].includes(key)
 const expectedIdentity = expectedComplete && key !== "changed-type"
 const frozen = frozenTree()
 stage("original-context-start")
 const reference = compareApiIdentityInWorker(ts, before.snapshot, current.snapshot, {
  beforeEntrypoints: { ".": join(before.snapshot, "index.d.ts") },
  afterEntrypoints: { ".": join(current.snapshot, "index.d.ts") },
  compilerOptions: { lib: before.options.lib, types: [] }
 })
 stage("original-context-done")
 assert.equal(reference.comparisonComplete, expectedComplete, "the original library context must give the independent stock oracle result")
 assert.equal(reference.identical, expectedIdentity)
 stage("snapshot-context-start")
 const actual = compareDeclarations(ts, before.snapshot, current.snapshot, { canonical: true })
 stage("snapshot-context-done")
 const unchanged = frozen === frozenTree()
 console.log(JSON.stringify({ key, mode, version: ts.version, lib,
  stockDiagnostics, migrationEligible: !invalidOriginal && key !== "unresolved", expectedComplete, expectedIdentity, unchanged,
  complete: actual.comparisonComplete, identical: actual.identical,
  blockingDiagnostics: actual.environmentDiagnostics.filter(d => d.blocking).map(d => d.diagnostic),
  ok: unchanged && (invalidOriginal ? reference.comparisonComplete === false && reference.identical === false
   : actual.comparisonComplete === expectedComplete && actual.identical === expectedIdentity)
 }))
} finally { rmSync(temp, { recursive: true, force: true }) }
