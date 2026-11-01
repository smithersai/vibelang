import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { loadTypeScript } from "../lib/declarations.mjs"
import { rewritePublishingScript, wirePublishingScripts } from "../lib/publishing.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-published-migrated-entry.json", import.meta.url), "utf8"))
const rule = "`x.vibe` emits `x.js` beside `x.d.ts` in `outDir`"
const spec = readFileSync(new URL("../../../../docs/design/src/007-tooling.md", import.meta.url), "utf8")
const execute = (text, manifest) => {
  const exports = {}
  const result = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true })
  assert.equal(result.diagnostics.length, 0)
  new Function("exports", result.outputText)(exports)
  return exports.packExports(manifest)
}

test("publication oracle quotes Chapter 7's output paths", () => assert.ok(spec.includes(rule)))

function check(input) {
  const path = (input.nested ? "nested/" : "") + input.name
  const original = "./src/" + path + "." + input.extension
  const source = "./src/" + path + ".vibe"
  const baseline = { exports: { ".": original, "./asset": "./data.json", "./none": null, "./conditional": { import: "./already.js", types: "./already.d.ts" } } }
  const migrated = { exports: { ...baseline.exports, ".": { types: "./src/" + path + ".d.vibe.ts", "vibelang-source": source, default: "./.vibelang/js/src/" + path + ".js" } } }
  if (input.shape === "legacy") migrated.exports["."] = { types: "./src/" + path + ".d.vibe.ts", default: source }
  const saved = structuredClone(migrated)
  const result = rewritePublishingScript(corpus.source, ts)
  assert.equal(rewritePublishingScript(result.text, ts).text, result.text, "second setup is byte-identical")
  const expected = execute(corpus.source, baseline)
  const actual = execute(result.text, migrated)
  assert.deepEqual(actual, expected, "published public names, JS and declaration paths are preserved")
  assert.deepEqual(migrated, saved, "normalization does not mutate the source manifest")
}

test("opencode-47: a published migrated entry keeps dist JavaScript and declarations", () => check(corpus.input))

test("opencode-47: the earlier paired-sidecar export also keeps its dist paths", () => check({ ...corpus.input, shape: "legacy" }))

test("property: publication helpers preserve installed export contracts", async () => {
  await checkProperty(fc, {
    name: "published-migrated-entry", rule, command: "node --test test/publishing.property.test.mjs",
    arbitrary: fc.record({ name: fc.constantFrom("index", "codemode", "skill", "service"), nested: fc.boolean(), extension: fc.constantFrom("ts", "tsx"), shape: fc.constantFrom("legacy", "emitted") }),
    check, numRuns: 100, regressions: new URL("./corpus/", import.meta.url)
  })
})

test("publication wiring reaches shared build helpers and leaves tests and test-only helpers alone", () => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-publish-"))
  const write = (file, text) => { const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
  try {
    write("package.json", JSON.stringify({ workspaces: ["packages/*"] }))
    write("packages/codemode/package.json", JSON.stringify({ name: "code", exports: "./src/index.ts", dependencies: { scripts: "workspace:*" } }))
    write("packages/scripts/package.json", JSON.stringify({ name: "scripts", exports: { "./pack": "./src/pack.ts" } }))
    write("packages/scripts/src/pack.ts", corpus.source)
    write("packages/scripts/test/pack.test.ts", corpus.source + '\nimport "../test-only.ts"\n')
    write("packages/scripts/test-only.ts", corpus.source)
    write("packages/scripts/fixtures/pack.ts", corpus.source)
    const result = wirePublishingScripts({ root, ts })
    assert.deepEqual(result.changed, ["packages/scripts/src/pack.ts"])
    for (const file of ["packages/scripts/test/pack.test.ts", "packages/scripts/test-only.ts", "packages/scripts/fixtures/pack.ts"]) {
      assert.equal(readFileSync(join(root, file), "utf8"), file.endsWith("pack.test.ts") ? corpus.source + '\nimport "../test-only.ts"\n' : corpus.source)
    }
    assert.equal(result.warnings.length, 3)
    assert.deepEqual(wirePublishingScripts({ root, ts }).changed, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("the rewrite preserves a shadowed or reassigned Object implementation", () => {
  for (const prefix of ["const Object = other;\n", "Object.entries = other;\n", "function f(Object) {}\n"]) {
    const source = prefix + corpus.source
    assert.equal(rewritePublishingScript(source, ts).text, source)
  }
})

test("plain JavaScript publication helpers gain no TypeScript syntax", () => {
  const result = rewritePublishingScript(corpus.source, ts, "pack.mjs")
  assert.equal(ts.createSourceFile("pack.mjs", result.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS).parseDiagnostics.length, 0)
  assert.deepEqual(execute(result.text, { exports: { ".": { "vibelang-source": "./src/index.vibe" } } }), { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } })
})

test("unsupported computed export expressions and omitted bindings stay byte-identical", () => {
  for (const source of [
    corpus.source.replace("pkg.exports", "getPackage().exports"),
    corpus.source.replace("[key, value]", "[key, ]"),
    corpus.source.replace("[key, value]", "[, value]")
  ]) assert.equal(rewritePublishingScript(source, ts).text, source)
})
