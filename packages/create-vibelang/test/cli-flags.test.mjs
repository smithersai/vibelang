import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const binPath = fileURLToPath(new URL("../bin/create-vibelang.mjs", import.meta.url))
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))

test("--help and -h print usage and exit 0", () => {
  for (const flag of ["--help", "-h"]) {
    const res = spawnSync(process.execPath, [binPath, flag], { encoding: "utf8" })
    assert.equal(res.status, 0, res.stderr)
    assert.match(res.stdout, /Usage: create-vibelang/)
  }
})

test("--version and -v print exact package version and exit 0", () => {
  for (const flag of ["--version", "-v"]) {
    const res = spawnSync(process.execPath, [binPath, flag], { encoding: "utf8" })
    assert.equal(res.status, 0, res.stderr)
    assert.equal(res.stdout.trim(), manifest.version)
  }
})

test("unknown option exits non-zero with usage diagnostic", () => {
  const res = spawnSync(process.execPath, [binPath, "--unknown-option-flag"], { encoding: "utf8" })
  assert.notEqual(res.status, 0)
  assert.match(res.stderr + res.stdout, /Usage: create-vibelang|Unknown/i)
})
