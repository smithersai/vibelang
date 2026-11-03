import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { test } from "node:test"
import { wireTestProjects } from "../lib/test-projects.mjs"
import corpus from "./corpus/foldkit-effect-lint-requirement-import.json" with { type: "json" }

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const effect = dirname(require.resolve("effect/package.json"))
const tick = String.fromCharCode(96)
const quote = "TypeScript's " + tick + "allowArbitraryExtensions" + tick + " resolves it, so plain " + tick + "tsc" + tick + " and TypeDoc understand imports of " + tick + ".vibe" + tick + " files."
const chapter = readFileSync(new URL("../../../../docs/design/src/001-functions.md", import.meta.url), "utf8")
function fixture(input = {}) {
  const root = mkdtempSync(join(tmpdir(), "foldkit-effect-lint-project-"))
  const dir = input.dir ?? "test", ext = input.ext ?? "vibe"
  const testDir = dir + (input.nested ? "/nested" : ""), relative = input.nested ? "../../src/" : "../src/"
  const put = (name, value) => {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), typeof value === "string" ? value : JSON.stringify(value))
  }
  put("package.json", { private: true, type: "module" })
  put("tsconfig.json", { compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "Bundler",
    strict: true, skipLibCheck: true, noEmit: true, types: [],
    allowArbitraryExtensions: true, allowImportingTsExtensions: true
  }, include: ["src"] })
  put("tsconfig.test.json", { extends: "./tsconfig.json", include: ["src", dir] })
  put("src/dep." + ext, corpus.source)
  put("src/dep.d." + ext + ".ts", corpus.declaration)
  const consumer = (specifier, sidecar = false) => {
    let source = (sidecar ? corpus.sidecarControl : corpus.native).replace(sidecar ? "./dep.d.vibe.ts" : "./dep.vibe", specifier)
    if (input.alias) source = source.replace("{ Needs }", "{ Needs as Requirement }").replace("E, Needs>", "E, Requirement>")
    return source
  }
  const file = testDir + "/viaNative.ts", control = testDir + "/viaSidecar.ts"
  put(file, consumer(relative + "dep." + ext))
  put(control, consumer(relative + "dep.d." + ext + ".ts", true))
  mkdirSync(join(root, "node_modules"), { recursive: true })
  symlinkSync(effect, join(root, "node_modules/effect"), "dir")
  return { root, dir, ext, file, control, put, packages: [{ dir: ".", sources: ["src"] }] }
}
function program(f) {
  const config = ts.findConfigFile(dirname(join(f.root, f.file)), ts.sys.fileExists)
  const read = ts.readConfigFile(config, ts.sys.readFile)
  assert.equal(read.error, undefined)
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(config), {}, config)
  assert.deepEqual(parsed.errors, [])
  return ts.createProgram(parsed.fileNames, parsed.options)
}
function inspect(input) {
  assert.ok(chapter.includes(quote), "the current Chapter 001 sidecar oracle")
  const f = fixture(input)
  try {
    const before = new Map([f.file, f.control, "tsconfig.json", "tsconfig.test.json"].map(p => [p, readFileSync(join(f.root, p))]))
    assert.equal(program(f).getSourceFile(join(f.root, f.file)), undefined, "the nearest main project omits both unchanged tests")
    const result = wireTestProjects({ ...f, ts })
    assert.deepEqual(result.changed, [f.dir + "/tsconfig.json"])
    assert.deepEqual(JSON.parse(readFileSync(join(f.root, f.dir, "tsconfig.json"))), { extends: "../tsconfig.test.json" })
    const after = program(f), checker = after.getTypeChecker()
    // Preserve the exact reported source, including its unprovided runPromise.
    // A real FileSystem requirement gives TS2345 on both import spellings.
    // Requiring a clean compile here would conceal that the minimized source
    // is intentionally not runnable without its platform service.
    const diagnostics = ts.getPreEmitDiagnostics(after)
    assert.equal(diagnostics.length, 2)
    assert.deepEqual(diagnostics.map(d => d.file.fileName).sort(), [f.file, f.control].map(p => join(f.root, p)).sort())
    for (const diagnostic of diagnostics) {
      assert.equal(diagnostic.code, 2345)
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
      assert.ok(message.includes("Effect<A, E, FileSystem>"), message)
      assert.ok(message.includes("Effect<A, E, never>"), message)
    }
    const origins = []
    for (const name of [f.file, f.control]) {
      const file = after.getSourceFile(join(f.root, name))
      assert.ok(file, "the actual test belongs to the discovered project")
      const imported = file.statements[1].importClause.namedBindings.elements[0].name
      const type = checker.getTypeAtLocation(imported)
      assert.equal(type.flags & ts.TypeFlags.Any, 0, "the actual Effect requirements channel must not silently become any")
      const symbol = checker.getAliasedSymbol(checker.getSymbolAtLocation(imported))
      origins.push(symbol.declarations.map(d => d.getSourceFile().fileName))
      assert.equal(checker.typeToString(type), "FileSystem")
    }
    const sidecar = join(f.root, "src/dep.d." + f.ext + ".ts")
    assert.deepEqual(origins, [[sidecar], [sidecar]], "both import spellings resolve the same real declared requirement")
    for (const [name, bytes] of before) assert.deepEqual(readFileSync(join(f.root, name)), bytes, name)
    assert.deepEqual(wireTestProjects({ ...f, ts }).changed, [])
  } finally { rmSync(f.root, { recursive: true, force: true }) }
}
test("foldkit-162: native and direct-sidecar requirement imports retain the real Effect R type in a containing project", () => inspect({}))
test("fast-check: requirement imports survive test directories, nested files, aliases and both native extensions", () => {
  fc.assert(fc.property(fc.record({
    dir: fc.constantFrom("test", "tests", "__tests__"),
    ext: fc.constantFrom("vibe", "vibex"), nested: fc.boolean(), alias: fc.boolean()
  }), inspect), { seed: 162139, numRuns: 24 })
})
test("missing declarations and any-valued requirements are detected by independent negative controls", () => {
  for (const mode of ["missing", "any"]) {
    const f = fixture()
    try {
      wireTestProjects({ ...f, ts })
      const sidecar = join(f.root, "src/dep.d.vibe.ts")
      if (mode === "missing") rmSync(sidecar)
      else f.put("src/dep.d.vibe.ts", "export type Needs = any; export declare const program: any;")
      const actual = program(f), checker = actual.getTypeChecker()
      if (mode === "missing") {
        assert.ok(ts.getPreEmitDiagnostics(actual).some(d => d.code === 2307 || d.code === 6263), "missing-sidecar errors must remain visible")
      } else {
        const file = actual.getSourceFile(join(f.root, f.file))
        const imported = file.statements[1].importClause.namedBindings.elements[0].name
        assert.notEqual(checker.getTypeAtLocation(imported).flags & ts.TypeFlags.Any, 0, "the requirements oracle rejects a real any mutation")
      }
    } finally { rmSync(f.root, { recursive: true, force: true }) }
  }
})
