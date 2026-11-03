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
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }

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
const form = fc.constantFrom(
  (s) => `import type { B } from "${s}";\nexport declare const a: B;\n`,
  (s) => `import { type B } from '${s}';\nexport declare const a: B;\n`,
  (s) => `export declare const a: import("${s}").B;\n`,
  (s) => `export type { B } from "${s}";\nexport declare const a: number;\n`,
  (s) => `// see "./b.vibe"\nimport type { B } from "${s}";\nexport declare const a: B;\n`
)
test("foldkit-161: every neighbour spelling and import form compares the API", () => {
  const outDir = mkdtempSync(join(tmpdir(), "migrate-sidecar-vibe-import-property-"))
  try {
    put(outDir, "b.d.ts", "export type B = number;\n")
    fc.assert(fc.property(spelling, form, fc.boolean(), (s, write, change) => {
      const sidecar = write(s)
      put(outDir, "a.d.ts", write("./b.js") + (change ? "export declare const added: string;\n" : ""))
      const result = sidecarChanges(ts, { "src/a.d.vibe.ts": sidecar, "src/b.d.vibe.ts": "export type B = number;\n" }, outDir)
      assert.equal(result.comparisonComplete, undefined, `${sidecar}\n${JSON.stringify(result.environmentDiagnostics)}`)
      assert.deepEqual(result.changed.map((c) => c.file), change ? ["src/a.d.vibe.ts"] : [], sidecar)
    }), { seed: 16101, numRuns: 120 })
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})
