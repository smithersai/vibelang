
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
const { restoreExports } = await import(process.env.REVERT_CODEMOD_UNDER_TEST || new URL("../lib/codemod.mjs", import.meta.url))
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-removed-import-map.json", import.meta.url), "utf8"))
function inspect({ field, mode, added, nested }) {
  const root = mkdtempSync(join(tmpdir(), "return-package-map-"))
  try {
    const file = join(root, "package.json")
    const source = nested ? "./src/nested/value.vibe" : "./src/value.vibe"
    const target = nested ? "src/nested/value.ts" : "src/value.ts"
    const key = field === "imports" ? "#source/value" : "./value"
    const before = { name: "return-control", version: "1.0.0", private: true, unrelated: { source }, exports: { ".": "./index.js" } }
    if (mode === "missing") delete before[field]
    else if (mode === "null") before[field] = null
    else if (mode === "scalar") before[field] = "./index.js"
    else before[field] = { keep: "./keep.js", ...(mode === "present" ? { [key]: source } : {}) }
    writeFileSync(file, JSON.stringify(before))
    const edit = { manifest: "package.json", field, key, module: target.replace(/\.ts$/, ".vibe"), ...(added ? { added: true } : {}) }
    const expected = structuredClone(before)
    if (mode === "present") {
      if (added) delete expected[field][key]
      else expected[field][key] = source.replace(/\.vibe$/, ".ts")
    }
    restoreExports(root, [edit], target)
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), expected)
    restoreExports(root, [edit], target)
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), expected, "replaying the journal is idempotent")
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("a return skips a generated package map that was already removed", () => inspect(corpus))
test("stale package-map journals preserve absent fields and unrelated entries", () => {
  fc.assert(fc.property(fc.record({
    field: fc.constantFrom("imports", "exports"),
    mode: fc.constantFrom("missing", "null", "scalar", "missing-key", "present"),
    added: fc.boolean(),
    nested: fc.boolean(),
  }), inspect), { seed: 351106, numRuns: 160 })
})
