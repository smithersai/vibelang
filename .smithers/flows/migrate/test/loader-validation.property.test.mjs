import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { checkLoaderRecords } from "../lib/declarations.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const rule = "A missing validation outcome is unverified: a later stage never inherits an earlier stage's exit."

test("loader validation oracle quotes VIP-34's tooling contract", () => {
  assert.ok(readFileSync(new URL("../../../../docs/design/src/007-tooling.md", import.meta.url), "utf8").includes(rule))
})

async function check({ mode, count, failedWrite, prior = false }) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-loader-validation-"))
  try {
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    const installed = join(root, "node_modules/vibelang")
    mkdirSync(installed, { recursive: true })
    writeFileSync(join(installed, "package.json"), JSON.stringify({ name: "vibelang", type: "module", exports: { "./project": "./project.mjs" } }))
    const calls = join(root, "calls.jsonl")
    const outcome = mode.replace(/^async-/, "")
    const body = mode === "missing-checker" ? "export const old = true" :
      mode === "null-checker" ? "export const checkLoaderRecord = null" :
      mode === "number-checker" ? "export const checkLoaderRecord = 1" :
      'import { appendFileSync } from "node:fs"; export ' + (mode.startsWith("async-") ? 'async ' : '') + 'function checkLoaderRecord({project}) { appendFileSync(' + JSON.stringify(calls) + ', JSON.stringify(project) + "\\n"); ' +
        (outcome === "throw" ? 'throw new Error("checker failed")' : outcome === "miss" ? 'return {miss:"input changed"}' : 'return {modules:1}') + ' }'
    if (mode !== "missing-module") writeFileSync(join(installed, "project.mjs"), body)
    const writes = Array.from({ length: count }, (_, i) => ({ project: `p${i}/tsconfig.json`, file: `p${i}/record.json`, modules: i + 1 }))
    const records = writes.map(entry => prior ? { ...entry, validation: "checked", unchecked: "stale unavailable", miss: "stale miss" } : entry)
    if (failedWrite) records.push({ project: "failed/tsconfig.json", errors: 1, first: "TS2322" })
    const before = structuredClone(records)
    const result = await checkLoaderRecords({ compiler: "unused", packageDir: root, root, records })
    assert.deepEqual(records, before, "validation preserves write receipts")
    assert.equal(result.length, records.length)
    const unavailable = mode.endsWith("checker") || mode === "missing-module"
    for (let i = 0; i < count; i++) {
      const { validation, unchecked, miss, ...write } = result[i]
      assert.deepEqual(write, writes[i])
      assert.equal(validation, unavailable ? "unavailable" : outcome === "throw" ? "failed" : "checked")
      if (unavailable) assert.ok(typeof unchecked === "string" && unchecked.length > 0)
      else assert.equal(unchecked, undefined)
      assert.equal(miss, outcome === "miss" ? "input changed" : outcome === "throw" ? "checker failed" : undefined)
    }
    if (failedWrite) assert.deepEqual(result.at(-1), records.at(-1), "a failed write is not a record to validate")
    const checked = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : []
    assert.deepEqual(checked, unavailable ? [] : records.filter(e => e.file !== undefined).map(e => join(root, e.project)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const modes = ["missing-module", "missing-checker", "null-checker", "number-checker", "hit", "miss", "throw", "async-hit", "async-miss", "async-throw"]
test("loader receipts distinguish unavailable validation, hits, misses and exceptions", async () => {
  for (const mode of modes) await check({ mode, count: 2, failedWrite: true, prior: true })
})
test("property: validation status follows checker availability for every written record", async () => {
  await fc.assert(fc.asyncProperty(fc.record({ mode: fc.constantFrom(...modes), count: fc.integer({ min: 0, max: 5 }), failedWrite: fc.boolean(), prior: fc.boolean() }), check), { numRuns: 60, seed: 34008 })
})
