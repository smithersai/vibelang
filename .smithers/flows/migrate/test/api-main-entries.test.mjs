import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { compareDeclarations } from "../lib/declarations.mjs"

const ts = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("typescript")
const manifest = { name: "fixture", private: true, type: "module", main: "./main.ts" }
const main = 'export { value } from "./leaf.js";\n', leaf = "export declare const value: number;\n"

// A main-only package (no export map) under includePrivate, as t3code Mobile.
function compare(t, before, after) {
  const root = mkdtempSync(join(tmpdir(), "migrate-api-main-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const side = (name, { files, source, leafFile, companions = [] }) => {
    const dir = join(root, name), stored = Object.keys(files).sort(), aliases = {}
    for (const file of stored) {
      mkdirSync(dirname(join(dir, file)), { recursive: true })
      writeFileSync(join(dir, file), files[file])
      aliases[file === "main.d.ts" ? "main.ts" : file === leafFile ? source : file] = file
    }
    writeFileSync(join(dir, "public-surface.json"), JSON.stringify({ roots: stored, reachable: stored, unresolved: [], resolutions: [], snapshotVersion: 3,
      apiMetadata: { manifest, layouts: [], projectContexts: [], aliases, logicalPaths: {}, packageDir: join(root, "package"), companions } }))
    return dir
  }
  return compareDeclarations(ts, side("before", before), side("after", after), { canonical: true, includePrivate: true })
}

test("VIP-40: a recorded module-body companion is not a main-only package entry", t => {
  const files = { "main.d.ts": main, "leaf.d.ts": leaf, "leaf.vibe.constants.d.ts": "export declare const hiddenValue: number;\n" }
  const before = { files: { "main.d.ts": main, "leaf.d.ts": leaf }, source: "leaf.ts", leafFile: "leaf.d.ts" }
  const result = compare(t, before, { files, source: "leaf.vibe", leafFile: "leaf.d.ts", companions: ["leaf.vibe.constants.d.ts"] })
  assert.equal(result.comparisonComplete, true)
  assert.deepEqual(result.nameDifferences, [])
  assert.equal(result.identical, true)
  // An unrecorded file is an authored entry and still counts.
  const authored = compare(t, before, { files, source: "leaf.vibe", leafFile: "leaf.d.ts" })
  assert.deepEqual(authored.nameDifferences, [{ entrypoint: "./leaf.vibe.constants.js", export: "*", side: "after" }])
})

test("a main-only package's renamed .mts entry keeps its logical name", t => {
  // main.ts exports an unrelated value; leaf is reachable only as a deep entry.
  const main = "export declare const entry: number;\n"
  const result = compare(t, { files: { "main.d.ts": main, "leaf.d.mts": leaf }, source: "leaf.mts", leafFile: "leaf.d.mts" },
    { files: { "main.d.ts": main, "leaf.d.ts": leaf }, source: "leaf.vibe", leafFile: "leaf.d.ts" })
  assert.deepEqual(result.renamed, [{ from: "leaf.d.mts", to: "leaf.d.ts" }])
  assert.deepEqual(result.nameDifferences, [])
  assert.equal(result.identical, true)
  // A destination already in the baseline is a collision, not a rename.
  const collision = compare(t, { files: { "main.d.ts": main, "leaf.d.mts": leaf, "leaf.d.ts": "export declare const other: boolean;\n" }, source: "leaf.mts", leafFile: "leaf.d.mts" },
    { files: { "main.d.ts": main, "leaf.d.ts": leaf }, source: "leaf.vibe", leafFile: "leaf.d.ts" })
  assert.equal(collision.identical, false)
})
