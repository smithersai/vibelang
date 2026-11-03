import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// A versioned reference environment keeps framework-only dependencies out of
// the docs toolchain. Publish a complete install atomically for parallel runs.
const here = path.dirname(fileURLToPath(import.meta.url))
const sources = ["package.json", "bun.lock", "modules.mjs.txt"].map(name => readFileSync(path.join(here, name)))
const key = createHash("sha256").update(Buffer.concat(sources)).digest("hex")
const base = path.join(here, ".cache")
const cache = path.join(base, key)
const pins = JSON.parse(sources[0]).devDependencies
const ready = directory => {
  try {
    return readFileSync(path.join(directory, "ready"), "utf8") === key &&
      Object.entries(pins).every(([name, version]) =>
        JSON.parse(readFileSync(path.join(directory, "node_modules", name, "package.json"), "utf8")).version === version)
  } catch { return false }
}
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
assert.ok(ready(cache), "framework reference install must be complete")
export const { babel, solid, reactTransform, createElement, createComponent, ts } = await import(pathToFileURL(path.join(cache, "modules.mjs")).href)
