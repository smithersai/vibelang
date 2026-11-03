import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"

const ts = loadTypeScript()
function fixture(change, check) {
  const root = mkdtempSync(join(tmpdir(), "api-provenance-"))
  try {
    for (const side of ["before", "after"]) {
      const dir = join(root, side)
      mkdirSync(join(dir, "dep"), { recursive: true })
      writeFileSync(join(dir, "package.json"), JSON.stringify({
        exports: { ".": { types: "./index.d.ts" }, "./other": { types: "./other.d.ts" } },
      }))
      writeFileSync(join(dir, "index.d.ts"), 'export type X = import("./dep.js").Value;')
      writeFileSync(join(dir, "dep.d.ts"), "export type Value = " + (change && side === "after" ? "number" : "string") + ";")
      writeFileSync(join(dir, "dep/index.d.ts"), "export type Value = boolean;")
      writeFileSync(join(dir, "private.d.ts"), "export type Hidden = symbol;")
      writeFileSync(join(dir, "other.d.ts"), "export type Other = bigint;")
      assert.equal(ts.resolveModuleName("./dep.js", join(dir, "index.d.ts"), {
        moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext,
      }, ts.sys).resolvedModule.resolvedFileName, join(dir, "dep.d.ts"), "stock resolver selects the file before the directory")
    }
    check(join(root, "before"), join(root, "after"))
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("optional provenance records actual selected dependencies and excludes private or shadowed files", () => {
  fixture(false, (before, after) => {
    const result = compareApiIdentity(ts, before, after, { includeComparedFiles: true })
    assert.equal(result.identical, true, JSON.stringify(result))
    for (const [side, base] of [["before", before], ["after", after]])
      assert.deepEqual(result.comparedFiles[side].map(file => relative(base, file)), ["dep.d.ts", "index.d.ts", "other.d.ts"])
    assert.equal(compareApiIdentity(ts, before, after).comparedFiles, undefined)
  })
})
test("provenance survives a real public type difference", () => {
  fixture(true, (before, after) => {
    const result = compareApiIdentity(ts, before, after, { includeComparedFiles: true })
    assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    assert.ok(result.typeDifferences.some(d => d.export === "X" && /TS2344/.test(d.diagnostic)), JSON.stringify(result))
    assert.ok(result.comparedFiles.before.includes(join(before, "dep.d.ts")))
    assert.ok(result.comparedFiles.after.includes(join(after, "dep.d.ts")))
  })
})
test("compared-file provenance is invariant across entrypoint batch boundaries", () => {
  fixture(false, (before, after) => {
    const a = compareApiIdentity(ts, before, after, { includeComparedFiles: true, entryBatchSize: 1 })
    const b = compareApiIdentity(ts, before, after, { includeComparedFiles: true, entryBatchSize: 8 })
    assert.equal(a.identical, true, JSON.stringify(a))
    assert.deepEqual(a.comparedFiles, b.comparedFiles)
  })
})
