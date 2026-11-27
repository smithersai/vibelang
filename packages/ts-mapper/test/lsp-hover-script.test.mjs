import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const testDir = new URL("./", import.meta.url)

test("lsp-hover.mjs and cross-file-stack.mjs pass Node syntax check", () => {
  for (const script of ["lsp-hover.mjs", "cross-file-stack.mjs"]) {
    const path = fileURLToPath(new URL(script, testDir))
    const res = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" })
    assert.equal(res.status, 0, `${script}: ${res.stderr}`)
  }
})
