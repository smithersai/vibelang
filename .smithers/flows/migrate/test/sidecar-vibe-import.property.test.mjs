import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { sidecarChanges } from "../lib/declarations.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-sidecar-vibe-import.json", import.meta.url), "utf8"))
import { put, forms, check, encode } from "./sidecar-vibe-import-oracle.mjs"
import { assertParallelProperty } from "../../../../scripts/testing/parallel-property.mjs"

// foldkit-161: Foldkit's committed sidecars import their neighbours as
// `./calendarDate.vibe`. The earlier-API probe copied them over the emitted
// `.d.ts` tree, where that name does not resolve, so setup stopped with TS2307
// for every run on packages/foldkit.
test("foldkit-161: the earlier-API probe resolves a sidecar's ./x.vibe import", () => {
  const outDir = mkdtempSync(join(tmpdir(), "migrate-sidecar-vibe-import-"))
  try {
    for (const [file, text] of Object.entries(corpus.emitted)) put(outDir, file, text)
    const result = sidecarChanges(ts, corpus.sidecars, outDir)
    assert.equal(result.comparisonComplete, undefined, JSON.stringify(result.environmentDiagnostics))
    assert.deepEqual(result, { files: 2, changed: [], missing: [] })

    // A real change behind the same import is still reported.
    put(outDir, "a.d.ts", corpus.changed)
    assert.deepEqual(sidecarChanges(ts, corpus.sidecars, outDir).changed.map((c) => c.file), ["src/a.d.vibe.ts"])
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})

// The neighbourhood: every spelling a sidecar can give a migrated neighbour,
// in every import form, completes the comparison, and reports a change exactly
// when the emitted type differs.
const spelling = fc.constantFrom("./b.vibe", "./b.vibex", "./b.js", "./b", "./sub/../b.vibe")
const form = fc.constantFrom(...forms)

test("foldkit-161: every neighbour spelling and import form compares the API", async () => {
  await assertParallelProperty(fc, {
    arbitraries: [spelling, form, fc.boolean()], oracle: check,
    module: new URL("./sidecar-vibe-import-oracle.mjs", import.meta.url),
    exportName: "checkEncoded", encode, seed: 16101, numRuns: 120
  })
})
