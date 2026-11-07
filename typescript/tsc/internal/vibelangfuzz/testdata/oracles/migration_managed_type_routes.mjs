import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { routeBundledImports } from "../../../../../../.smithers/flows/migrate/lib/bundled-imports.mjs"
const repo = fileURLToPath(new URL("../../../../../../", import.meta.url))
const require = createRequire(join(repo, "packages/runtime/package.json")), ts = require("typescript")
const corpus = JSON.parse(readFileSync(new URL("../corpus/t3code-managed-type-query-routes.json", import.meta.url), "utf8"))
const [key, rawMode, binary] = process.argv.slice(2), mode = Number(rawMode) & 15
const [stage, form] = key.split(":")
const root = mkdtempSync(join(tmpdir(), "managed-type-route-"))
const put = (file, value) => { const p = join(root, file); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, typeof value === "string" ? value : JSON.stringify(value)) }
const stem = "src/" + (mode & 1 ? "nested/space δ/" : "") + "actions"
const model = "src/" + (mode & 1 ? "nested/space δ/" : "") + "model.vibe"
const alias = "#vibelang/emitted/" + stem
const quote = text => mode & 4 ? "'" + text + "'" : JSON.stringify(text)
const manifest = { name: "managed-type-route-fixture", private: true, type: "module", imports: { "#keep": "./keep.js" } }
const conditions = { types: "./" + stem + ".d.vibe.ts", "vibelang-source": "./" + stem + ".vibe", default: "./.vibelang/js/" + stem + ".js" }
const compilerOptions = { target: "ES2022", module: mode & 8 ? "ESNext" : "NodeNext", moduleResolution: mode & 8 ? "bundler" : "NodeNext", strict: true, types: [], allowArbitraryExtensions: true, rootDir: "." }
const env = { ...process.env, VIBELANG_RUNTIME: join(repo, "packages/runtime"), VIBELANG_DISABLE_CACHE: "1" }
const native = (args) => {
 const result = spawnSync(binary, args, { cwd: root, env, encoding: "utf8", timeout: 60000, maxBuffer: 8 << 20 })
 assert.equal(result.error, undefined, String(result.error))
 assert.ok(result.status === 0 || result.status === 2, result.stdout + result.stderr)
 return { status: result.status, codes: [...new Set((result.stdout + result.stderr).match(/\b(?:TS|EK)\d+\b/g) ?? [])].sort(), output: result.stdout + result.stderr }
}
const checkNative = () => native(["-p", "tsconfig.json", "--noEmit", "--allowImportingTsExtensions", "true", "--pretty", "false"])
const expectedType = form === "import-type" ? '"ok"' : form === "type-query" ? "7" : "number"
let source = form === "return-type" ? corpus.model.replaceAll("#vibelang/emitted/src/actions", alias)
 : form === "import-type" ? "export type Result = import(" + quote(alias) + ").Kind;\nexport const result: Result = \"ok\";\n"
 : form === "type-query" ? "export type Result = (typeof import(" + quote(alias) + "))[\"code\"];\nexport const result: Result = 7;\n"
 : "import { make } from " + quote(alias) + ";\nexport type Result = ReturnType<typeof make>;\nexport const result: Result = 1;\n"
if (mode & 4 && form === "return-type") source = source.replaceAll('"' + alias + '"', quote(alias))
if (mode & 2) source = source.replaceAll("\n", "\r\n")
function shape(text) {
 const file = ts.createSourceFile("model.ts", text, ts.ScriptTarget.Latest, true)
 assert.equal(file.parseDiagnostics.length, 0)
 function visit(node) {
  const p = node.parent
  const moduleLiteral = ts.isStringLiteralLike(node) && (
   ((ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === node) ||
   (ts.isLiteralTypeNode(p) && ts.isImportTypeNode(p.parent) && p.parent.argument === p))
  if (moduleLiteral) return ["module-specifier"]
  const children = []; ts.forEachChild(node, child => { children.push(visit(child)) })
  return [node.kind, !ts.isSourceFile(node) && typeof node.text === "string" ? node.text : null,
   node.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let), node.isTypeOf ?? null, node.isTypeOnly ?? null, ...children]
 }
 return visit(file)
}
function stock() {
 // The source is ordinary TypeScript. Its byte-identical twin has the same
 // containing directory and package conditions; only the root extension differs.
 const file = join(root, model.replace(/\.vibe$/, ".oracle.ts")), text = readFileSync(join(root, model), "utf8")
 const options = { strict: true, noEmit: true, types: [], lib: ["lib.es5.d.ts"], target: ts.ScriptTarget.ES2022,
  module: mode & 8 ? ts.ModuleKind.ESNext : ts.ModuleKind.NodeNext,
  moduleResolution: mode & 8 ? ts.ModuleResolutionKind.Bundler : ts.ModuleResolutionKind.NodeNext,
  allowArbitraryExtensions: true, allowImportingTsExtensions: true }
 const host = ts.createCompilerHost(options, true), original = host.getSourceFile.bind(host)
 const exists = host.fileExists.bind(host), read = host.readFile.bind(host)
 host.fileExists = name => name === file || exists(name)
 host.readFile = name => name === file ? text : read(name)
 host.getSourceFile = (name, languageVersion, ...args) => {
  if (name !== file) return original(name, languageVersion, ...args)
  const parsed = ts.createSourceFile(name, text, languageVersion, true, ts.ScriptKind.TS)
  parsed.impliedNodeFormat = ts.ModuleKind.ESNext
  return parsed
 }
 const program = ts.createProgram([file], options, host)
 const diagnostics = ts.getPreEmitDiagnostics(program)
 const checker = program.getTypeChecker(), symbol = checker.getSymbolAtLocation(program.getSourceFile(file))
 const exports = symbol ? checker.getExportsOfModule(symbol) : []
 const value = exports.find(s => s.name === "result")
 return { codes: [...new Set(diagnostics.map(d => "TS" + d.code))].sort(),
  names: exports.map(s => s.name).sort(), type: value ? checker.typeToString(checker.getTypeOfSymbolAtLocation(value, value.valueDeclaration)) : null }
}
function observation(nativeCheck, phase) {
 assert.deepEqual(shape(readFileSync(join(root, model), "utf8")), shape(source), "routing may change only module specifiers")
 assert.equal(readFileSync(join(root, stem + ".vibe"), "utf8"), corpus.actions)
 assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).imports["#keep"], "./keep.js")
 const result = stock()
 assert.deepEqual(result.names, ["Result", "result"])
 if (!result.codes.length) assert.equal(result.type, expectedType, "routed public type must remain exact")
 const actual = nativeCheck ? checkNative() : null
 if (actual) assert.deepEqual(actual.codes, result.codes, phase + ": native compiler must agree with its ordinary TypeScript twin\n" + actual.output)
 return { stock: result, native: actual }
}
try {
 mkdirSync(join(root, "node_modules"), { recursive: true })
 symlinkSync(dirname(require.resolve("effect/package.json")), join(root, "node_modules/effect"), "dir")
 symlinkSync(join(repo, "packages/runtime"), join(root, "node_modules/vibelang-runtime"), "dir")
 put("package.json", manifest); put("keep.js", "export const keep = 1;\n")
 put(stem + ".vibe", corpus.actions)
 put("tsconfig.actions.json", { compilerOptions, files: [stem + ".vibe"] })
 const bootstrap = native(["-p", "tsconfig.actions.json", "--noEmit", "false", "--declaration", "true", "--emitDeclarationOnly", "false", "--outDir", ".vibelang/js", "--pretty", "false"])
 assert.equal(bootstrap.status, 0, bootstrap.output)
 const emittedHeader = ".vibelang/js/" + stem + ".d.ts"
 assert.ok(existsSync(join(root, emittedHeader)), "the compatibility declaration comes from the actual compiler")
 put(stem + ".d.vibe.ts", readFileSync(join(root, emittedHeader), "utf8"))
 assert.ok(existsSync(join(root, ".vibelang/js/" + stem + ".js")))
 manifest.imports[alias] = conditions; put("package.json", manifest)
 put(model, source); put("tsconfig.json", { compilerOptions, files: [stem + ".vibe", model] })
 const nativeCheck = mode === 0
 const before = observation(true, "before")
 assert.deepEqual(before.stock.codes, [], "the real original route must resolve")
 const good = readFileSync(join(root, model), "utf8")
 put(model, good.replace(/export const result: Result = [^;]+;/, "export const result: Result = false;"))
 const negative = stock()
 assert.ok(negative.codes.includes("TS2322"), JSON.stringify(negative))
 put(model, good)
 // The flow passes its native compiler: VibeLang importers are read from its syntax tree.
 const restored = routeBundledImports({ root, packages: [{ dir: ".", sources: ["src"] }], ts, compiler: binary, restore: true })
 const afterRestore = observation(nativeCheck, "restore")
 const rebuilt = routeBundledImports({ root, packages: [{ dir: ".", sources: ["src"] }], ts, compiler: binary, native: true, outputs: { [stem + ".vibe"]: ".vibelang/js/" + stem + ".js" } })
 const afterRebuild = observation(nativeCheck, "rebuild")
 console.log(JSON.stringify({ key, mode, bootstrap: { status: bootstrap.status, codes: bootstrap.codes },
  before, negative, restored, rebuilt, afterRestore, afterRebuild, nativeCheck }))
} finally { rmSync(root, { recursive: true, force: true }) }
