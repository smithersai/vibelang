import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

test("the optional Vitest smoke explains its upstream hash-path limitation before compiling", t => {
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-windows-smoke-"))
  t.after(() => rmSync(scratch, { recursive: true, force: true }))
  const project = join(scratch, "project#hash")
  mkdirSync(project)
  const script = fileURLToPath(new URL("./windows-smoke.mjs", import.meta.url))
  const result = spawnSync(process.execPath, [script, project, "--vitest"], { encoding: "utf8", timeout: 10_000 })
  assert.equal(result.status, 2, result.stdout + result.stderr)
  assert.match(result.stderr, /Vitest.*project path containing #/)
  assert.match(result.stderr, /without --vitest/)
  assert.match(result.stderr, /--vitest from a path without #/)
  assert.equal(existsSync(join(project, "src")), false, "unsupported runner root is rejected before creating fixture files")
})
