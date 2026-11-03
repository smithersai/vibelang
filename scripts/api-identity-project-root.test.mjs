import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/foldkit-project-root-probe.json", import.meta.url)))
const ts = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
function fixture({ composite = false, explicit = true, json = false, unused = false, value = 1 }, run) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-project-root-"))
  const compilerOptions = {
    strict: true, noEmit: true, types: [], target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    resolveJsonModule: true, noUnusedLocals: unused, noUnusedParameters: unused,
    configFilePath: join(root, "tsconfig.json"), composite,
    ...(explicit ? { rootDir: root } : {}),
  }
  try {
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {
      strict: true, composite, ...(explicit ? { rootDir: "." } : {}),
    } }))
    for (const side of ["before", "after"]) {
      const dir = join(root, side)
      mkdirSync(dir)
      writeFileSync(join(dir, "package.json"), JSON.stringify({ exports: {
        ".": { types: "./index.d.ts" }, ...(json ? { "./data.json": "./data.json" } : {}),
      } }))
      writeFileSync(join(dir, "index.d.ts"), corpus[side].replace("count:1", `count:${value}`))
      if (json) writeFileSync(join(dir, "data.json"), '{"enabled":true}')
    }
    return run(join(root, "before"), join(root, "after"), compilerOptions, root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
function valid(dir, compilerOptions, json = false) {
  const roots = [join(dir, "index.d.ts"), ...(json ? [join(dir, "data.json")] : [])]
  const program = ts.createProgram(roots, compilerOptions)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: x => x, getCurrentDirectory: () => dir, getNewLine: () => "\n",
  }))
}
function verify(input) {
  fixture(input, (before, after, compilerOptions) => {
    valid(before, compilerOptions, input.json)
    valid(after, compilerOptions, input.json)
    for (const other of [before, after]) {
      const result = compareApiIdentity(ts, before, other, { compilerOptions })
      assert.equal(result.identical, true, JSON.stringify(result))
      assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    }
    writeFileSync(join(after, "index.d.ts"), `export declare function f<T>(value: T): { value: T; count: ${(input.value ?? 1) + 1} };`)
    valid(after, compilerOptions, input.json)
    const result = compareApiIdentity(ts, before, after, { compilerOptions })
    assert.equal(result.identical, false, JSON.stringify(result))
    assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    assert.ok(result.typeDifferences.some(item => item.export === "f"), JSON.stringify(result))
  })
}
test("virtual probes respect an explicit rootDir", () => verify({ explicit: true, value: 1 }))
test("virtual probes respect composite's implicit project root", () => verify({ composite: true, explicit: false, value: 1 }))
test("JSON exports stay compared under composite and rootDir", () => verify({ composite: true, explicit: true, json: true, unused: true, value: 1 }))
test("real source files outside rootDir still invalidate both input copies", () => {
  fixture({}, (before, after, options, root) => {
    const compilerOptions = { ...options, rootDir: join(root, "src") }
    for (const dir of [before, after]) {
      writeFileSync(join(dir, "index.d.ts"), 'export type Value = typeof import("./outside").value;')
      writeFileSync(join(dir, "outside.ts"), "export const value = 1;")
      const program = ts.createProgram([join(dir, "index.d.ts")], compilerOptions)
      assert.ok(ts.getPreEmitDiagnostics(program).some(diagnostic => diagnostic.code === 6059))
    }
    const result = compareApiIdentity(ts, before, after, { compilerOptions })
    assert.equal(result.identical, false, JSON.stringify(result))
    assert.equal(result.comparisonComplete, false, JSON.stringify(result))
    assert.deepEqual(result.typeDifferences, [])
    assert.ok(result.environmentDiagnostics.some(item => item.blocking && /TS6059/.test(item.diagnostic)), JSON.stringify(result))
  })
})
test("property: project-root self comparisons preserve options and real type mutations", async () => {
  await checkProperty(fc, {
    name: "api-identity-project-root-self",
    rule: corpus.rule,
    command: "node --test scripts/api-identity-project-root.test.mjs",
    arbitrary: fc.record({ composite: fc.boolean(), explicit: fc.boolean(), json: fc.boolean(), unused: fc.boolean(), value: fc.integer({ min: -10, max: 10 }) }),
    numRuns: 24,
    check: verify,
  })
})
