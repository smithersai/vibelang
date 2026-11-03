import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"

const ts = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/opencode-google-auth-ambient-import.json", import.meta.url)))
const options = { strict: true, noEmit: true, skipLibCheck: false, types: [], target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext }
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
function valid(file) {
  const program = ts.createProgram([file], options)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: x => x, getCurrentDirectory: () => dirname(file), getNewLine: () => "\n",
  }))
}
function fixture({ module = "node:fixture", generic = false, query = false, label = "value" } = {}, run) {
  const root = mkdtempSync(join(tmpdir(), "api-ambient-imports-"))
  const before = join(root, "before"), after = join(root, "after")
  // Both names live in one physical file but name different nominal classes.
  put(join(root, "shared.d.ts"), corpus.ambient.replaceAll("node:fixture", module) + "\n" +
    corpus.ambient.replaceAll("node:fixture", module + "/other"))
  const parameter = generic ? "<T = string>" : ""
  const dependency = query
    ? `export declare class Client${parameter} { private hidden; ${label}: import(${JSON.stringify(module)}).Shape; }`
    : corpus.dependency.replaceAll("node:fixture", module).replace("class Client", "class Client" + parameter).replace("value: Shape", label + ": Shape")
  try {
    for (const dir of [before, after]) {
      put(join(dir, "package.json"), '{"types":"index.d.ts"}')
      put(join(dir, "index.d.ts"), '/// <reference path="../shared.d.ts"/>\n' + corpus.entry)
      put(join(dir, "node_modules/auth/package.json"), '{"name":"auth","version":"1.0.0","types":"index.d.ts"}')
      put(join(dir, "node_modules/auth/index.d.ts"), dependency)
      valid(join(dir, "index.d.ts"))
    }
    put(join(root, "consumer.ts"), 'import type { load as A } from "./before/index.js"; import type { load as B } from "./after/index.js"; declare let a: typeof A; declare let b: typeof B; a = b; b = a;')
    valid(join(root, "consumer.ts"))
    return run({ before, after, dependency, module })
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const compare = (before, after) => compareApiIdentity(ts, before, after, { compilerOptions: options, moduleRoots: [] })
function verify(shape) {
  fixture(shape, ({ before, after, dependency, module }) => {
    for (const other of [before, after]) {
      const result = compare(before, other)
      assert.equal(result.comparisonComplete, true, JSON.stringify(result))
      assert.equal(result.identical, true, JSON.stringify(result))
    }
    for (const changed of [dependency.replace("private hidden", "private changed"), dependency.replaceAll(module, module + "/other")]) {
      put(join(after, "node_modules/auth/index.d.ts"), changed)
      valid(join(after, "index.d.ts"))
      const result = compare(before, after)
      assert.equal(result.identical, false, JSON.stringify(result))
      assert.ok(result.typeDifferences.length || result.environmentDiagnostics.some(x => x.blocking), JSON.stringify(result))
    }
  })
}

test("copied external private classes retain identity through ambient module imports", () => verify())
test("a genuinely missing ambient import leaves both original inputs invalid", () => {
  fixture({}, ({ before, after, dependency }) => {
    for (const dir of [before, after]) put(join(dir, "node_modules/auth/index.d.ts"), dependency.replace("node:fixture", "node:missing"))
    const result = compare(before, after)
    assert.equal(result.comparisonComplete, false, JSON.stringify(result))
    assert.equal(result.identical, false)
    assert.equal(result.typeDifferences.length, 0)
    assert.ok(result.environmentDiagnostics.some(x => /TS2307/.test(x.diagnostic)), JSON.stringify(result))
    assert.ok(result.environmentDiagnostics.some(x => x.blocking && /unresolved or erroneous/.test(x.diagnostic)), JSON.stringify(result))
  })
})
test("property: ambient import closures preserve self identity and selected module identity", async () => {
  await checkProperty(fc, {
    name: "api-identity-ambient-imports", generatorVersion: 1,
    rule: "Will: a tree compared with itself must be identical; ambient imports stay in the comparison and real nominal differences must not be hidden.",
    command: "node --test scripts/api-identity-ambient-imports.test.mjs",
    arbitrary: fc.record({ module: fc.constantFrom("node:fixture", "http", "virtual:auth"), generic: fc.boolean(), query: fc.boolean(), label: fc.constantFrom("value", "response") }),
    numRuns: 24, check: verify,
  })
})
