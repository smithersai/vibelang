import assert from "node:assert/strict"
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { loadTypeScript } from "../lib/declarations.mjs"
import { rewritePublishingScript, wirePublishingScripts } from "../lib/publishing.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-sdk-conditional-imports.json", import.meta.url), "utf8"))
const rule = "`x.vibe` emits `x.js` beside `x.d.ts` in `outDir`"
const spec = readFileSync(new URL("../../../../docs/design/src/007-tooling.md", import.meta.url), "utf8")
const execute = (text, manifest, name) => {
  const out = {}
  const result = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true })
  assert.equal(result.diagnostics.length, 0)
  new Function("exports", result.outputText)(out)
  return out.packImports(manifest, name)
}
function check(input) {
  const original = "./src/" + input.name + ".ts"
  const source = "./src/" + input.name + ".vibe"
  const wrapper = input.shape === "legacy"
    ? { types: "./src/" + input.name + ".d.vibe.ts", default: source }
    : { "vibelang-source": source, default: "./.vibelang/js/src/" + input.name + ".js" }
  const conditions = { types: "./src/database/v1-migration.bun.ts", bun: "./src/database/v1-migration.bun.ts" }
  for (const name of input.conditions) conditions[name] = original
  const baseline = { exports: { ".": original, "./native": "./src/native.tsx", "./conditional": { import: "./native.js" } }, imports: { "#v1-migration": conditions, "#asset": { default: "./data.json" } } }
  const migrated = structuredClone(baseline)
  migrated.exports["."] = structuredClone(wrapper)
  for (const name of input.conditions) migrated.imports["#v1-migration"][name] = structuredClone(wrapper)
  let sourceText = corpus.source
  if (input.renamed) sourceText = sourceText.replace(/\boutput\b/g, "publishedPath").replace(/\bpkg\b/g, "manifest").replace(/\bconditions\b/g, "targets").replace(/\bcondition\b/g, "mode").replace(/\bvalue\b/g, "target")
  const fileName = input.javascript ? "verify-package.mjs" : "verify-package.ts"
  if (input.javascript) sourceText = sourceText.replace(/: string/g, "")
  const result = rewritePublishingScript(sourceText, ts, fileName)
  assert.deepEqual(execute(result.text, migrated, input.package), execute(sourceText, baseline, input.package), "nested condition names and published JS/types paths match the original script")
  assert.equal(result.changed, true)
  assert.equal(ts.createSourceFile(fileName, result.text, ts.ScriptTarget.Latest, true).parseDiagnostics.length, 0)
  assert.equal(rewritePublishingScript(result.text, ts, fileName).text, result.text, "second setup is byte-identical")
}
test("sdk publication oracle quotes Chapter 7 output paths", () => assert.ok(spec.includes(rule)))
test("opencode sdk nested imports keep their dist paths", () => check(corpus.input))
test("opencode sdk legacy paired-sidecar imports keep their dist paths", () => check({ ...corpus.input, shape: "legacy" }))
test("property: sdk nested imports preserve native publication policy", async () => {
  await checkProperty(fc, {
    name: "sdk-conditional-imports", rule, command: "node --test test/publishing-imports.property.test.mjs",
    arbitrary: fc.record({
      name: fc.constantFrom("database/v1-migration.noop", "nested/skill", "index", "service"),
      package: fc.constantFrom("core", "plugin", "sdk"),
      conditions: fc.subarray(["node", "workerd", "default", "development"], { minLength: 1 }),
      shape: fc.constantFrom("legacy", "emitted"), renamed: fc.boolean(), javascript: fc.boolean()
    }),
    check, numRuns: 100, regressions: new URL("./corpus/", import.meta.url)
  })
})
test("sdk publication keeps unrelated native tsx suffix behavior", () => {
  const result = rewritePublishingScript(corpus.source, ts)
  const pkg = { exports: { ".": "./src/native.tsx" }, imports: { "#native": { node: "./src/native.tsx", default: "./src/native.js" } } }
  assert.deepEqual(execute(result.text, structuredClone(pkg), "core"), execute(corpus.source, structuredClone(pkg), "core"))
})
test("sdk publication leaves unmarked condition objects unsupported as before", () => {
  const pkg = { imports: { "#native": { node: { import: "./src/native.ts" } } } }
  const result = rewritePublishingScript(corpus.source, ts)
  assert.throws(() => execute(corpus.source, structuredClone(pkg), "core"), /replace/)
  assert.throws(() => execute(result.text, structuredClone(pkg), "core"), /replace/)
})
test("sdk publication does not trust a rebound Object", () => {
  for (const prefix of ["const Object = other;\n", "Object.entries = other;\n", "function f(Object) {}\n"]) {
    const source = prefix + corpus.source
    assert.equal(rewritePublishingScript(source, ts).text, source)
  }
})

test("setup wires the sdk verify script and leaves a test fixture untouched", () => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-sdk-publish-"))
  const write = (file, text) => { const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
  try {
    write("package.json", JSON.stringify({ workspaces: ["packages/*"] }))
    write("packages/sdk/package.json", JSON.stringify({ name: "sdk", scripts: { "verify:package": "bun script/verify-package.ts" } }))
    write("packages/sdk/script/verify-package.ts", corpus.source)
    write("packages/sdk/test/verify-package.test.ts", corpus.source)
    const result = wirePublishingScripts({ root, ts })
    assert.deepEqual(result.changed, ["packages/sdk/script/verify-package.ts"])
    assert.equal(readFileSync(join(root, "packages/sdk/test/verify-package.test.ts"), "utf8"), corpus.source)
    assert.equal(result.warnings.length, 1)
    assert.deepEqual(wirePublishingScripts({ root, ts }).changed, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test("publication skips a shadowed or reassigned named output mapper", () => {
  for (const extra of ["\noutput = custom\n", "\nfunction unrelated(output) { return output }\n"]) {
    const source = corpus.source + extra
    assert.equal(rewritePublishingScript(source, ts).text, source)
  }
})
