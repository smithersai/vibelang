import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { compareDeclarations } from "../lib/declarations.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-ordinary-ts-import-provenance.json", import.meta.url)))

function compare(before, after, metadata) {
  const root = mkdtempSync(join(tmpdir(), "migrate-fallback-"))
  try {
    for (const [side, text] of [["before", before], ["after", after]]) {
      const dir = join(root, side)
      mkdirSync(dir)
      writeFileSync(join(dir, "main.d.ts"), text)
      if (metadata === "resolved" || metadata === "unresolved" || metadata === side) {
        writeFileSync(join(dir, "public-surface.json"), JSON.stringify({
          roots: ["main.d.ts"], reachable: ["main.d.ts"],
          unresolved: metadata === "unresolved" ? ["./missing.ts"] : []
        }))
      }
    }
    return compareDeclarations(ts, join(root, "before"), join(root, "after"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("t3code: legacy declaration baselines preserve ordinary TS imports, order and comments", () => {
  assert.ok(readFileSync(new URL("../rules.md", import.meta.url), "utf8").includes("a published package’s emitted declarations must stay identical."))
  for (const metadata of ["none", "before", "after", "unresolved", "resolved"]) {
    for (const { before, after } of corpus.modules) {
      const result = compare(before, after, metadata)
      assert.equal(result.identical, false, metadata + ": " + before)
      assert.equal(result.comparison, metadata === "resolved" ? "public bytes" : "all bytes")
      assert.deepEqual(result.changed.map(file => file.file), ["main.d.ts"])
      assert.ok(result.changed[0].diff.length)
      assert.equal(compare(before, before, metadata).identical, true)
    }
  }
})

test("property: missing or unresolved public metadata never weakens the raw declaration gate", () => {
  // VIP-27/detail 263 preserve ordinary TypeScript sibling references; detail
  // 277 includes import order and provenance in the required declaration surface.
  fc.assert(fc.property(
    fc.constantFrom("none", "before", "after", "unresolved", "resolved"),
    fc.integer({ min: 0, max: corpus.modules.length - 1 }),
    fc.stringMatching(/^[a-z][a-z0-9_-]{0,12}$/), fc.boolean(),
    (metadata, pattern, name, changed) => {
      const witness = corpus.modules[pattern]
      const before = witness.before.replaceAll("config", name)
      const after = changed ? witness.after.replaceAll("config", name) : before
      assert.equal(compare(before, after, metadata).identical, before === after)
    }
  ), { seed: 263277, numRuns: 160 })
})
