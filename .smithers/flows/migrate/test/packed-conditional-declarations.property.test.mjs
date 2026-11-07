import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "../../../../scripts/api-identity.mjs"
import { rewritePublishingScript } from "../lib/publishing.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const ts = loadTypeScript([join(repo, "packages/runtime")])
const fc = createRequire(join(repo, "packages/runtime/package.json"))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-packed-conditional-declarations.json", import.meta.url), "utf8"))
const mapper = JSON.parse(readFileSync(new URL("./corpus/opencode-sdk-conditional-imports.json", import.meta.url), "utf8")).source
const options = {
  strict: true, noEmit: true, skipLibCheck: false, types: [], lib: ["lib.es5.d.ts"],
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
}
function mapNative(source, manifest) {
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }, reportDiagnostics: true })
  assert.deepEqual(compiled.diagnostics, [])
  const out = {}
  new Function("exports", compiled.outputText)(out)
  return out.packImports(structuredClone(manifest), "core")
}
function scenario(input) {
  const root = mkdtempSync(join(tmpdir(), "packed-native-condition-"))
  const put = (side, file, value) => {
    const path = join(root, side, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value))
  }
  const stem = input.nested ? "native/host" : "host", alias = input.wildcard ? "#host/*" : "#host"
  const requested = input.wildcard ? "#host/host" : "#host"
  const target = input.wildcard ? "./dist/native/*.js" : "./dist/" + stem + ".js"
  const types = input.wildcard ? "./dist/types/native/*.d.ts" : "./dist/types/" + stem + ".d.ts"
  const source = input.wildcard ? "./src/native/*.ts" : "./src/" + stem + ".ts"
  const native = { imports: { [alias]: { default: source } } }
  const current = rewritePublishingScript(mapper, ts)
  assert.deepEqual(mapNative(current.text, native), mapNative(mapper, native), "authored native publication policy stays intact")
  const declaration = corpus.entry.replaceAll("#host", requested)
  const manifest = { name: "native-condition-fixture", version: "1.0.0", type: "module",
    types: "./dist/types/index.d.ts", imports: { [alias]: { default: target } } }
  const plainHeader = corpus.host.replace("1", JSON.stringify(input.value))
  const hostStem = input.wildcard ? "native/host" : stem
  const header = "dist/types/" + hostStem + ".d.ts", js = "dist/" + hostStem + ".js"
  try {
    for (const side of ["before", "after"]) {
      put(side, "package.json", manifest)
      put(side, header, plainHeader)
      put(side, js, "export const value = " + JSON.stringify(input.value) + "\n")
      put(side, "src/" + hostStem + ".ts", "export const value = " + JSON.stringify(input.value) + " as const\n")
      put(side, "dist/types/index.d.ts", declaration)
    }
    const diagnostics = side => ts.getPreEmitDiagnostics(ts.createProgram([join(root, side, "dist/types/index.d.ts")], options))
    assert.ok(diagnostics("before").some(d => d.code === 7016), "stock TypeScript rejects the packed JavaScript-only condition")
    const compare = () => compareApiIdentity(ts, join(root, "before"), join(root, "after"), { compilerOptions: options })
    const unavailable = compare()
    assert.equal(unavailable.identical, false, "equal unresolved declarations prove no API identity")
    assert.match(JSON.stringify(unavailable), /TS7016/)
    const typed = { ...manifest, imports: { [alias]: { default: { types, default: target } } } }
    for (const side of ["before", "after"]) put(side, "package.json", typed)
    assert.deepEqual(diagnostics("before").map(d => d.code), [], "the real published declaration condition restores resolution")
    const complete = compare()
    assert.equal(complete.identical, true, JSON.stringify(complete))
    put("after", header, plainHeader.replace(JSON.stringify(input.value), JSON.stringify(input.value + 1)))
    assert.equal(compare().identical, false, "a resolving condition must retain the literal type")
    for (const side of ["before", "after"]) put(side, "package.json", {
      ...manifest, imports: { [alias]: { default: source } },
    })
    assert.deepEqual(diagnostics("before").map(d => d.code), [], "the unchanged native-source condition is independently valid")
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("packed conditional declaration contract is quoted from the migration flow", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(corpus.rule))
  assert.ok(readFileSync(SpecPath("001-functions.md"), "utf8").includes("Declaration output is API-identical to what `tsc` writes for the Effect TypeScript twin"))
})
test("captured packed import refuses unavailable identity and accepts the real declaration condition", () => {
  scenario({ nested: false, wildcard: false, value: 1 })
})
test("property: conditional declaration availability retains exact public literal types", async () => {
  await fc.assert(fc.property(fc.record({
    nested: fc.boolean(), wildcard: fc.boolean(), value: fc.integer({ min: 1, max: 99 }),
  }), scenario), { numRuns: 16, seed: 701648 })
})
