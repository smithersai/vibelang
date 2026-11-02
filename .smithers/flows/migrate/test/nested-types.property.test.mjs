import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { test } from "node:test"
import { renameBatch, restoreExports, rewriteExports } from "../lib/codemod.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const quote = "points each package's `exports`, `imports`, `main`, `module` and `types` at the renamed modules"
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-nested-types-default.json", import.meta.url), "utf8"))

function check(source, manifest, expected, field = "exports", entry = "./client", bareEntries = false, sidecarDir) {
  const root = mkdtempSync(join(tmpdir(), "migrate-nested-types-"))
  try {
    mkdirSync(dirname(join(root, source)), { recursive: true })
    writeFileSync(join(root, source), "export interface Value {readonly n:number}; export const value=1\n")
    writeFileSync(join(root, "package.json"), JSON.stringify(manifest) + "\n")
    if (sidecarDir) writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { rootDir: "." }, vibe: { sidecarDir } }))
    const renames = renameBatch(root, [source])
    const edits = rewriteExports(root, renames, { bareEntries })
    const after = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    assert.deepEqual(after[field][entry], expected, "type-condition descendants must remain declaration paths")
    const once = readFileSync(join(root, "package.json"), "utf8")
    assert.deepEqual(rewriteExports(root, renames, { bareEntries }), [], "a second pass is stable")
    assert.equal(readFileSync(join(root, "package.json"), "utf8"), once)
    restoreExports(root, edits, source)
    assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"), "utf8")), manifest, "revert restores the complete original map")
  } finally { rmSync(root, { recursive: true, force: true }) }
}

// Declaration lookup selects these leaves through nested condition objects.
// Build the before/after trees from the same shape and distinct semantic leaves;
// the oracle never repeats pointAt's condition-recognition walk.
function tree(leaf, layers) {
  return layers.reduce((value, kind) => {
    switch (kind) {
      case "array": return [null, value, "./fallback.d.ts"]
      case "pair": return { node: value, browser: "./browser.d.ts" }
      default: return { [kind]: value }
    }
  }, leaf)
}

test("opencode: already-routed exports keep nested types.default on its sidecar", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(quote))
  check(corpus.source, corpus.manifest, corpus.expected)
})

test("opencode: nested type conditions keep a configured sidecar directory", () => {
  const expected = structuredClone(corpus.expected)
  expected.types.default = "./.types/src/client.d.vibe.ts"
  check(corpus.source, corpus.manifest, expected, "exports", "./client", false, ".types")
})

test("property: nested types and typings retain declaration context through conditions and arrays", () => {
  const segment = fc.stringMatching(/^[a-z][a-z0-9_-]{0,9}$/)
  fc.assert(fc.property(
    fc.array(segment, { minLength: 1, maxLength: 3 }),
    fc.constantFrom("types", "typings"),
    fc.constantFrom("exports", "imports"),
    fc.array(fc.constantFrom("default", "import", "require", "development", "array", "pair"), { minLength: 1, maxLength: 5 }),
    fc.boolean(),
    fc.boolean(),
    (parts, typeKey, field, layers, bare, relocated) => {
      const name = parts.join("/")
      const source = "src/" + name + ".ts"
      const entry = (field === "exports" ? "./" : "#") + name
      const emitted = "./.vibelang/js/src/" + name + ".js"
      const before = { [typeKey]: tree("./" + source, layers), "vibelang-source": "./" + source, default: emitted }
      const after = { [typeKey]: tree((relocated ? "./.types/src/" : "./src/") + name + ".d.vibe.ts", layers), "vibelang-source": "./src/" + name + ".vibe", default: emitted }
      check(source, { name: "nested-types-property", [field]: { [entry]: before } }, after, field, entry, bare, relocated ? ".types" : undefined)
    }
  ), { seed: 20261102, numRuns: 300 })
})

for (const sidecarDir of [undefined, ".types"]) test("a native TypeScript consumer resolves the nested declaration sidecar after rename: " + (sidecarDir ?? "beside"), () => {
  const ts = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))("typescript")
  const root = mkdtempSync(join(tmpdir(), "migrate-nested-types-consumer-"))
  try {
    const pkg = join(root, "pkg")
    mkdirSync(join(pkg, "src"), { recursive: true })
    mkdirSync(join(pkg, ".vibelang/js/src"), { recursive: true })
    mkdirSync(join(root, "node_modules"))
    symlinkSync(pkg, join(root, "node_modules/fixture"), "dir")
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ ...corpus.manifest, name: "fixture" }))
    writeFileSync(join(pkg, "src/client.ts"), "export interface Value {readonly n:number}; export const value=1\n")
    writeFileSync(join(pkg, ".vibelang/js/src/client.js"), "export const value=1\n")
    const declaration = join(pkg, sidecarDir ?? ".", "src/client.d.vibe.ts")
    mkdirSync(dirname(declaration), { recursive: true })
    if (sidecarDir) writeFileSync(join(pkg, "tsconfig.json"), JSON.stringify({ compilerOptions: { rootDir: "." }, vibe: { sidecarDir } }))
    writeFileSync(declaration, "export interface Value {readonly n:number}; export declare const value:number\n")
    const entry = join(root, "consumer.ts")
    writeFileSync(entry, 'import type {Value} from "fixture/client"; export const value:Value={n:1}\n')
    const renames = renameBatch(root, ["pkg/src/client.ts"])
    rewriteExports(root, renames)
    const options = { strict: true, noEmit: true, skipLibCheck: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext }
    const resolved = ts.resolveModuleName("fixture/client", entry, options, ts.sys).resolvedModule
    assert.equal(resolved?.resolvedFileName, declaration)
    const program = ts.createProgram([entry], options)
    assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [], "the original API types are available to a native consumer")
  } finally { rmSync(root, { recursive: true, force: true }) }
})
