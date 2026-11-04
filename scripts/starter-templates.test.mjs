import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

test("every starter compiles and runs without legacy forms or warnings", { timeout: 240_000 }, () => {
  const result = spawnSync("bun", ["test", "--timeout", "180000", "docs/tools/starter-templates.test.ts"], {
    cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 210_000,
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
