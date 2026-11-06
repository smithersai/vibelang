// A native module body emits a companion declaration beside its parent. It is
// emitted support, so the parent's exports decide the module's API.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { test } from "node:test"
import { compareDeclarations } from "../lib/declarations.mjs"

const ts = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("typescript")
const companion = "source.vibe.-24-call-24-ts.d.ts"
const parent = "export declare const value: number;\n"

function snapshot(root, side, source, files, companions) {
  const dir = join(root, side)
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), text)
  }
  const stored = Object.keys(files)
  writeFileSync(join(dir, "public-surface.json"), JSON.stringify({
    roots: [], reachable: [], unresolved: [], resolutions: [], snapshotVersion: 3,
    apiMetadata: { manifest: { name: "fixture", private: true }, layouts: [], projectContexts: [],
      aliases: Object.fromEntries(stored.map(file => [file === "source.d.ts" ? source : file, file])),
      logicalPaths: {}, packageDir: join(root, "package"), ...(companions ? { companions } : {}) } }))
  return dir
}

function compare(after, companions = [companion]) {
  const root = mkdtempSync(join(tmpdir(), "migrate-module-body-"))
  try {
    const before = snapshot(root, "before", "source.ts", { "source.d.ts": parent })
    return compareDeclarations(ts, before, snapshot(root, "after", "source.vibe", after, companions), { canonical: true, includePrivate: true })
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("an internal module body is not a new entrypoint", () => {
  const result = compare({ "source.d.ts": parent, [companion]: "export declare function identity(value: number): number;\n" })
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, true, JSON.stringify(result))
})

test("a reexported module body still counts through its parent", () => {
  const result = compare({ "source.d.ts": parent + 'export * from "./source.vibe.-24-call-24-ts";\n',
    [companion]: "export declare function identity(value: number): number;\n" })
  assert.equal(result.identical, false, JSON.stringify(result))
  assert.ok(result.nameDifferences.some(difference => difference.export === "identity"), JSON.stringify(result))
})

test("a declaration not recorded as a companion stays a new entrypoint", () => {
  const result = compare({ "source.d.ts": parent, "other.d.ts": "export declare const other: string;\n" }, undefined)
  assert.equal(result.identical, false, JSON.stringify(result))
})
