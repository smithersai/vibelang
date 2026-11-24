import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

test("CI stamps complete results and preserves a truncated result", t => {
  const root = mkdtempSync(join(tmpdir(), "ci-stamp-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, "run-graph.json")
  const stamp = fileURLToPath(new URL("./testing/stamp-ci-results.mjs", import.meta.url))
  const startedAt = "2026-11-24T00:00:00Z"
  const results = { results: [{ label: "//:failed", status: "failed" }] }
  for (const input of [JSON.stringify(results), '{"results":']) {
    writeFileSync(file, input)
    const child = spawnSync(process.execPath, [stamp, file, startedAt], { encoding: "utf8" })
    assert.ifError(child.error)
    assert.equal(child.status, 0, child.stderr)
    const output = readFileSync(file, "utf8")
    if (input.endsWith(":")) assert.equal(output, input)
    else assert.deepEqual(JSON.parse(output), { ...results, startedAt })
  }
})
