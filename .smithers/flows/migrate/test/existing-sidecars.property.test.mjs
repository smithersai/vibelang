import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, globSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { test } from "node:test"
const { rewriteSourceLiterals } = process.env.SOURCE_SELECTORS_MODULE
  ? await import(process.env.SOURCE_SELECTORS_MODULE) : await import("../lib/source-paths.mjs")
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const sample = JSON.parse(readFileSync(new URL("./corpus/foldkit-docpage-existing-sidecar.json", import.meta.url)))

test("foldkit selector proof counts a previously matched sidecar before proposing any exclusion", () => {
  const r = rewriteSourceLiterals(ts, sample.text, sample.file, sample.renames, { inventory: sample.files })
  assert.equal(r.edits.length, 0, "the existing stale sidecar was selected before and may not disappear from the proof")
  assert.equal(r.text, sample.text)
  assert.ok(r.selectorChecks.some(p => p.contexts.some(c => c.before.includes("page/stale.d.vibe.ts"))))
})

test("generated actual glob inventories preserve existing declarations in the original matched set", () => {
  fc.assert(fc.property(fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}$/), { minLength: 1, maxLength: 7 }), fc.boolean(), (names, ordinary) => {
    const root = mkdtempSync(join(tmpdir(), "selector-old-sidecar-"))
    try {
      const inventory = names.map(n => "page/" + n + ".ts").concat("page/stale.d.vibe.ts", ordinary ? ["page/types.d.ts"] : [])
      for (const file of inventory) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), "") }
      const before = [...globSync("page/**/*.ts", { cwd: root })].sort()
      assert.ok(before.includes("page/stale.d.vibe.ts"))
      const moves = names.map(n => ({ from: "page/" + n + ".ts", to: "page/" + n + ".vibe" }))
      const r = rewriteSourceLiterals(ts, sample.text, sample.file, moves, { inventory })
      assert.equal(r.edits.length, 0)
      const proof = r.selectorChecks[0].contexts.find(c => c.base === "src")
      assert.deepEqual(proof.before, before)
      assert.ok(proof.dropped.includes("page/stale.d.vibe.ts"))
      assert.equal(proof.pass, false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { seed: 679494, numRuns: 100 })
})
