import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL, fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { test } from "node:test"
import { loadTypeScript } from "../lib/declarations.mjs"
import { rewritePublishingScript } from "../lib/publishing.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-published-layer-node-singleton.json", import.meta.url)))
const helper = JSON.parse(readFileSync(new URL("./corpus/opencode-published-migrated-entry.json", import.meta.url))).source
const productionHelper = helper + "\nexport function packImports(pkg) {\n  const exports = packExports(pkg)\n  const imports = Object.fromEntries(Object.entries(pkg.imports).map(([key, conditions]) => [\n    key, Object.fromEntries(Object.entries(conditions).map(([condition, value]) => [\n      condition, condition === \"types\" ? nativeHeader(value) : nativeOutput(value)\n    ]))\n  ]))\n  return { exports, imports }\n}\nfunction nativeHeader(value) { return value.replace(\"./src/\", \"./dist/\").replace(/\\.tsx?$/, \".d.ts\") }\nfunction nativeOutput(value) { return value.replace(\"./src/\", \"./dist/\").replace(/\\.tsx?$/, \".js\") }\n"
const sdkHelper = JSON.parse(readFileSync(new URL("./corpus/opencode-sdk-conditional-imports.json", import.meta.url))).source
const rule = "the program loads one copy of the module"
const spec = readFileSync(new URL("../../../../docs/design/src/007-tooling.md", import.meta.url), "utf8")
function execute(text, manifest) {
  const out = {}
  const result = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true })
  assert.deepEqual(result.diagnostics, [])
  new Function("exports", result.outputText)(out)
  return out.packImports ? out.packImports(manifest, "core") : out.packExports(manifest)
}
async function check(input) {
  const source = "./src/" + input.stem + "." + input.extension
  const runtime = "./.vibelang/js/src/" + input.stem + ".js"
  const target = { types: source, "vibelang-source": source, default: runtime }
  const manifest = { exports: { ".": target, "./masked": null, "./asset": "./asset.json", "./conditional": { import: "./original.js", types: "./original.d.ts" } } }
  manifest.imports = { "#native": { types: source, "vibelang-source": source, default: input.nested ? structuredClone(target) : runtime } }
  const saved = structuredClone(manifest)
  const text = (input.helper === "sdk" ? sdkHelper : productionHelper).replaceAll("./dist/", "./" + input.outdir + "/")
  const rewritten = rewritePublishingScript(text, ts)
  assert.equal(rewritePublishingScript(rewritten.text, ts).text, rewritten.text, "setup is byte-idempotent")
  const result = execute(rewritten.text, manifest)
  const published = result.exports ?? result
  const privateRuntime = result.imports?.["#native"].default ?? runtime
  const nativeSource = "./src/" + input.stem + "." + (input.extension === "vibe" ? "ts" : input.extension)
  const baseline = execute(text, { exports: { ".": nativeSource }, imports: { "#native": { types: nativeSource, default: nativeSource } } })
  const baselineExports = baseline.exports ?? baseline
  assert.equal(published["."].types, baselineExports["."].types, "the helper retains its authored declaration policy")
  assert.equal(published["./masked"], null)
  assert.deepEqual(published["./conditional"], manifest.exports["./conditional"])
  if (input.helper !== "sdk") assert.deepEqual(manifest, saved, "normalization preserves a non-mutating helper")

  const root = mkdtempSync(join(tmpdir(), "vibelang-published-runtime-"))
  const bodies = {
    symbol: 'const key=Symbol("graph");export const make=()=>({[key]:{kind:"node"}});export const resolve=value=>value[key].kind;',
    class: 'class Node{};export const make=()=>new Node;export const resolve=value=>value instanceof Node;',
    cell: 'const cell={value:0};export const make=()=>{cell.value++;return cell};export const resolve=value=>{if(value!==cell)throw Error("separate module state");return value.value};',
  }
  try {
    writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
    for (const file of [runtime, "./" + input.outdir + "/" + input.stem + ".js"]) {
      const output = join(root, file)
      mkdirSync(dirname(output), { recursive: true })
      writeFileSync(output, bodies[input.kind])
    }
    const publicModule = await import(pathToFileURL(join(root, published["."].import)).href)
    const privateModule = await import(pathToFileURL(join(root, privateRuntime)).href)
    const value = privateModule.resolve(publicModule.make())
    assert.equal(value, input.kind === "symbol" ? "node" : input.kind === "class" ? true : 1, "public and private routes share the same module instance")
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("publication singleton oracle quotes Chapter 7", () => assert.ok(spec.includes(rule)))
test("opencode: native layer nodes retain their private symbol across publication", () => check(corpus.input))
test("property: published routed modules retain symbol, class and closure identity", async () => {
  await checkProperty(fc, {
    name: "published-runtime-singleton", rule,
    command: "node --test test/publishing-runtime-identity.property.test.mjs",
    arbitrary: fc.record({
      stem: fc.constantFrom("index", "effect/layer-node", "nested/state", "space name", "雪"),
      extension: fc.constantFrom("ts", "vibe"), kind: fc.constantFrom("symbol", "class", "cell"),
      outdir: fc.constantFrom("dist", "build", "lib"), helper: fc.constantFrom("simple", "sdk"), nested: fc.boolean(),
    }),
    check, numRuns: 120, regressions: new URL("./corpus/", import.meta.url),
  })
})
