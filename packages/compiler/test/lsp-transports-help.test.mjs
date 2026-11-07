import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"
const native = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/vibelang", import.meta.url))
test("language-server help identifies reserved transports accurately", () => {
  for (const help of ["--help", "-h"]) {
    const result = spawnSync(native, ["--lsp", help], { encoding: "utf8", timeout: 10000 })
    for (const option of ["pipe", "socket"]) {
      assert.match(result.stderr, new RegExp("-" + option + " string\\s+Reserved for compatibility; only --stdio is currently supported\\."))
    }
  }
})
test("reserved transport arguments fail clearly without opening files", () => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-lsp-transport-"))
  try {
    fc.assert(fc.property(fc.constantFrom("--pipe", "--socket"), fc.constantFrom("endpoint", "with space", "深い/分析"), (option, value) => {
      const result = spawnSync(native, ["--lsp", option, value], { cwd: root, encoding: "utf8", timeout: 10000 })
      assert.equal(result.status, 1)
      assert.match(result.stderr, /only stdio is supported/)
      assert.equal(result.stdout, "")
      assert.deepEqual(readdirSync(root), [])
    }), { numRuns: 12 })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

