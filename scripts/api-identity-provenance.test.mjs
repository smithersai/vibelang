import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { createRequire } from "node:module"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"

import { createEs5FixtureGuard } from "./testing/fixture-libraries.mjs"
import { checkProperty } from "./testing/property.mjs"

const { ts, assertLibraries } = createEs5FixtureGuard(loadTypeScript(), "Provenance fixtures")
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const compilerOptions = { lib: ["lib.es5.d.ts"] }
const nativeOptions = { ...compilerOptions, strict: true, noEmit: true, types: [],
  moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext }
function fixture(change, check, { selected = "string", shadow = "boolean", hidden = "symbol", diagnosticCodes = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "api-provenance-"))
  try {
    for (const side of ["before", "after"]) {
      const dir = join(root, side)
      mkdirSync(join(dir, "dep"), { recursive: true })
      writeFileSync(join(dir, "package.json"), JSON.stringify({
        exports: { ".": { types: "./index.d.ts" }, "./other": { types: "./other.d.ts" } },
      }))
      writeFileSync(join(dir, "index.d.ts"), 'export type X = import("./dep.js").Value;')
      writeFileSync(join(dir, "dep.d.ts"), "export type Value = " + (change && side === "after" ? "number" : selected) + ";")
      writeFileSync(join(dir, "dep/index.d.ts"), "export type Value = " + (side === "after" ? shadow : "boolean") + ";")
      writeFileSync(join(dir, "private.d.ts"), "export type Hidden = " + (side === "after" ? hidden : "symbol") + ";")
      writeFileSync(join(dir, "other.d.ts"), "export type Other = bigint;")
      const program = ts.createProgram([join(dir, "index.d.ts"), join(dir, "other.d.ts")], nativeOptions)
      assertLibraries()
      assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), diagnosticCodes,
        "stock TypeScript validates each snapshot independently")
      assert.ok(program.getSourceFile(join(dir, "dep.d.ts")), "the selected dependency is in the native closure")
      assert.equal(program.getSourceFile(join(dir, "dep/index.d.ts")), undefined)
      assert.equal(program.getSourceFile(join(dir, "private.d.ts")), undefined)
      assert.equal(ts.resolveModuleName("./dep.js", join(dir, "index.d.ts"), {
        moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext,
      }, ts.sys).resolvedModule.resolvedFileName, join(dir, "dep.d.ts"), "stock resolver selects the file before the directory")
    }
    check(join(root, "before"), join(root, "after"))
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("optional provenance records actual selected dependencies and excludes private or shadowed files", () => {
  fixture(false, (before, after) => {
    const result = guardedCompare(before, after, { includeComparedFiles: true })
    assert.equal(result.identical, true, JSON.stringify(result))
    for (const [side, base] of [["before", before], ["after", after]])
      assert.deepEqual(result.comparedFiles[side].map(file => relative(base, file)), ["dep.d.ts", "index.d.ts", "other.d.ts"])
    assert.equal(guardedCompare(before, after).comparedFiles, undefined)
  })
})
test("provenance survives a real public type difference", () => {
  fixture(true, (before, after) => {
    const result = guardedCompare(before, after, { includeComparedFiles: true })
    assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    assert.ok(result.typeDifferences.some(d => d.export === "X" && /TS2344/.test(d.diagnostic)), JSON.stringify(result))
    assert.ok(result.comparedFiles.before.includes(join(before, "dep.d.ts")))
    assert.ok(result.comparedFiles.after.includes(join(after, "dep.d.ts")))
  })
})
test("compared-file provenance is invariant across entrypoint batch boundaries", () => {
  fixture(false, (before, after) => {
    const a = guardedCompare(before, after, { includeComparedFiles: true, entryBatchSize: 1 })
    const b = guardedCompare(before, after, { includeComparedFiles: true, entryBatchSize: 8 })
    assert.equal(a.identical, true, JSON.stringify(a))
    assert.deepEqual(a.comparedFiles, b.comparedFiles)
  })
})

function guardedCompare(before, after, options) {
  const result = compareApiIdentity(ts, before, after, { ...options, compilerOptions })
  assertLibraries()
  return result
}

test("provenance fixture libraries preserve native selected dependency types", () => {
  fixture(true, (before, after) => {
    for (const [base, selected, wrong] of [[before, "string", "number"], [after, "number", "string"]]) {
      const file = join(base, "consumer.ts")
      writeFileSync(file, 'import type { X } from "./index.js"; declare const x: X; const same: ' +
        selected + '=x; const different: ' + wrong + '=x;')
      const program = ts.createProgram([file], nativeOptions)
      assertLibraries()
      assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [2322])
    }
  })
})

test("provenance fixture libraries retain native missing BigInt errors", () => {
  fixture(false, (before, after) => {
    const result = guardedCompare(before, after, { includeComparedFiles: true })
    assert.equal(result.identical, false, JSON.stringify(result))
    assert.equal(result.comparisonComplete, false, JSON.stringify(result))
    assert.ok(result.environmentDiagnostics.some(d => d.blocking && /TS2583/.test(d.diagnostic)), JSON.stringify(result))
  }, { selected: "BigInt", diagnosticCodes: [2583] })
})

test("property: provenance excludes shadowed mutations and retains selected mutations across batches", async () => {
  await checkProperty(fc, {
    name: "api-identity-provenance-selection",
    rule: "Compared files follow resolved public dependencies, exclude private and shadowed declarations, and retain selected type changes across batch sizes.",
    command: "node --test scripts/api-identity-provenance.test.mjs",
    arbitrary: fc.record({
      literal: fc.integer({ min: 0, max: 1000 }),
      shadow: fc.constantFrom("string", "number", "symbol", "bigint"),
      hidden: fc.constantFrom("string", "number", "boolean", "bigint"),
      batch: fc.constantFrom(1, 8),
    }),
    numRuns: 4,
    check: ({ literal, shadow, hidden, batch }) => fixture(false, (before, after) => {
      const options = { includeComparedFiles: true, entryBatchSize: batch }
      const unchanged = guardedCompare(before, after, options)
      assert.equal(unchanged.identical, true, JSON.stringify(unchanged))
      for (const [side, base] of [["before", before], ["after", after]])
        assert.deepEqual(unchanged.comparedFiles[side].map(file => relative(base, file)), ["dep.d.ts", "index.d.ts", "other.d.ts"])
      writeFileSync(join(after, "dep.d.ts"), "export type Value = " + (literal + 1) + ";")
      const changed = guardedCompare(before, after, options)
      assert.equal(changed.identical, false, JSON.stringify(changed))
      assert.equal(changed.comparisonComplete, true, JSON.stringify(changed))
      assert.ok(changed.typeDifferences.some(d => d.export === "X" && /TS2344/.test(d.diagnostic)), JSON.stringify(changed))
      assert.deepEqual(changed.comparedFiles, unchanged.comparedFiles)
    }, { selected: String(literal), shadow, hidden }),
  })
})
