import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"
const native = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/vibelang", import.meta.url))
test("language-server help succeeds without requiring a transport or creating profiles", () => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-lsp-help-"))
  try {
    fc.assert(fc.property(fc.constantFrom("--help", "-h"), fc.boolean(), fc.boolean(), (help, configured, first) => {
      const options = configured ? ["--stdio", "--pprofDir", join(root, "profiles")] : []
      const result = spawnSync(native, ["--lsp", ...(first ? [help, ...options] : [...options, help])], { cwd: root, encoding: "utf8", timeout: 10000 })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.match(result.stderr, /Usage of lsp:/)
      assert.match(result.stderr, /stdio/)
      assert.equal(result.stdout, "")
      assert.deepEqual(readdirSync(root), [])
    }), { numRuns: 16 })
    const invalid = spawnSync(native, ["--lsp", "--unknown-option"], { cwd: root, encoding: "utf8", timeout: 10000 })
    assert.equal(invalid.status, 2)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

