import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { sources, key, base, cache, ready } from "./reference.mjs"

if (!ready(cache)) {
  mkdirSync(base, { recursive: true })
  const stage = mkdtempSync(path.join(base, "install-"))
  try {
    for (const [index, name] of ["package.json", "bun.lock", "modules.mjs"].entries()) writeFileSync(path.join(stage, name), sources[index])
    const installed = spawnSync("bun", ["install", "--frozen-lockfile", "--ignore-scripts"], { cwd: stage, encoding: "utf8", timeout: 120000 })
    assert.equal(installed.error, undefined, String(installed.error))
    assert.equal(installed.status, 0, installed.stdout + installed.stderr)
    writeFileSync(path.join(stage, "ready"), key)
    assert.ok(ready(stage), "framework reference must match every exact package pin")
    try { renameSync(stage, cache) } catch (error) { if (!ready(cache)) throw error }
  } finally { rmSync(stage, { recursive: true, force: true }) }
}
