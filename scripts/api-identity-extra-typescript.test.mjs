import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const root = fileURLToPath(new URL("../", import.meta.url))
function select(directory) {
  const env = { ...process.env, API_IDENTITY_EXTRA_TS: directory }
  delete env.NODE_TEST_CONTEXT
  return spawnSync(process.execPath, [
    "--test", "--test-reporter=tap",
    "--test-name-pattern=^compiler-selection-only$",
    "scripts/api-identity-opencode-global.test.mjs",
  ], {
    cwd: root, encoding: "utf8", timeout: 20_000,
    env,
  })
}
function verifySelection(result, expected) {
  assert.equal(result.error, undefined, result.error?.message)
  assert.doesNotMatch(result.stdout + result.stderr, /run\(\) is being called recursively/)
  assert.equal(result.signal, null)
  assert.equal(result.status, expected, result.stdout + result.stderr)
}

test("optional compiler selection keeps the default compiler available", () => {
  verifySelection(select(""), 0)
})
test("optional compiler selection accepts an explicitly installed real compiler API", () => {
  verifySelection(select(join(root, "docs/tools")), 0)
})
for (const kind of ["missing", "without-api", "null-api", "broken"]) {
  test("optional compiler selection rejects a requested " + kind + " compiler instead of falling back", () => {
    const directory = mkdtempSync(join(tmpdir(), "api-explicit-ts-"))
    try {
      if (kind !== "missing") {
        const module = join(directory, "node_modules/typescript")
        mkdirSync(module, { recursive: true })
        writeFileSync(join(module, "package.json"), JSON.stringify({ name: "typescript", main: "index.cjs" }))
        writeFileSync(join(module, "index.cjs"), kind === "without-api"
          ? 'module.exports = { version: "invalid-api" }\n'
          : kind === "null-api" ? "module.exports = null\n"
          : 'throw new Error("compiler fixture cannot load")\n')
      }
      const result = select(directory)
      verifySelection(result, 1)
      assert.match(result.stdout + result.stderr, /API_IDENTITY_EXTRA_TS/)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
}
