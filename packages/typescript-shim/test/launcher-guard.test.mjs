import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const launcherPath = fileURLToPath(new URL("../launcher.mjs", import.meta.url))
const source = readFileSync(launcherPath, "utf8")

test("launcher.mjs passes Node syntax check", () => {
  const res = spawnSync(process.execPath, ["--check", launcherPath], { encoding: "utf8" })
  assert.equal(res.status, 0, res.stderr)
})

test("launcher.mjs enforces paired vibelang version and propagates formatter env", () => {
  assert.ok(source.includes("manifest.dependencies.vibelang"), "launcher must read paired vibelang version")
  assert.ok(source.includes("if (found !== wanted)"), "launcher must refuse mismatched vibelang versions")
  assert.ok(source.includes("VIBELANG_FORMAT_NODE"), "launcher must pass VIBELANG_FORMAT_NODE")
  assert.ok(source.includes("VIBELANG_FORMAT_MODULE"), "launcher must pass VIBELANG_FORMAT_MODULE")
  assert.ok(source.includes("process.execve"), "launcher must prefer execve on POSIX")
  assert.ok(source.includes("execFileSync"), "launcher must keep child-process fallback")
})
