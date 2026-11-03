// Exercise the real corpus checker: source fixtures may deliberately contain
// constant conditions. Keep ESLint reports; only their provenance is in question.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const here = fileURLToPath(new URL(".", import.meta.url))
const cases = [
  ["do-jumps", "function f() { const v = do { found: { if (true) break found; 1 } 2 }; return v }"],
  ["boolean", "if (false) { void 1 }"],
  ["numeric", "if (0x10) { void 1 }"],
  ["string", "const v = \"yes\" ? 1 : 2; void v"],
  ["bigint", "if (1n) { void 1 }"],
  ["regexp", "if (/yes/u) { void 1 }"],
  ["unicode-offset", "/* 😀 */\r\nif (true) { void 1 }"]
]

for (const [name, code] of cases) {
  test("corpus oracle accepts an ordinary source literal condition: " + name, () => {
    const dir = mkdtempSync(join(tmpdir(), "vibelang-corpus-constants-"))
    try {
      const tests = join(dir, "packages/compiler/test/eslint")
      mkdirSync(tests, { recursive: true })
      for (const file of ["corpus.test.mjs", "helpers.mjs", "tree.mjs", "config.mjs"]) copyFileSync(join(here, file), join(tests, file))
      // Independent oracle fixes can add this module without breaking composition.
      try { copyFileSync(join(here, "lint-oracle.mjs"), join(tests, "lint-oracle.mjs")) }
      catch (error) { if (error.code !== "ENOENT") throw error }
      symlinkSync(join(here, "node_modules"), join(tests, "node_modules"), "dir")
      symlinkSync(join(here, "node_modules"), join(dir, "node_modules"), "dir")
      symlinkSync(fileURLToPath(new URL("../../eslint.mjs", import.meta.url)), join(dir, "packages/compiler/eslint.mjs"))
      mkdirSync(join(dir, "samples"))
      writeFileSync(join(dir, "samples/main.vibe"), code)
      const env = { ...process.env }
      delete env.NODE_TEST_CONTEXT
      const run = spawnSync(process.execPath, ["--test", "--test-name-pattern=every .vibe file lints", join(tests, "corpus.test.mjs")], {
        encoding: "utf8", env, timeout: 30_000
      })
      assert.equal(run.status, 0, code + "\n" + run.stdout + run.stderr)
      assert.match(run.stdout, /pass 1\b/, "the real corpus test must execute")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
