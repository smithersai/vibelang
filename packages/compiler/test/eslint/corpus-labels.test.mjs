// Exercise the actual corpus checker with the real ESLint rule, scope manager
// and native parser; source labels may legitimately be unused in fixtures.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, readFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const here = fileURLToPath(new URL(".", import.meta.url))
const cases = [
  ["foldkit-website-labeled-arrow", readFileSync(new URL("./corpus/foldkit-website-labeled-arrow.vibe", import.meta.url), "utf8")],
  ["block", "label: { const value = 1; void value }"],
  ["loop", "label: for (let i = 0; i < 1; i++) { void i }"],
  ["nested", "outer: { inner: { void 1 } }"],
  ["function", "export function f() { label: { return 1 } }"],
  ["unicode", "éclair: { void 1 }"],
  ["escaped", "lab" + "\\u0065" + "l: { void 1 }"]
]

for (const [name, code] of cases) {
  test("corpus oracle accepts an ordinary unused source label: " + name, () => {
    const dir = mkdtempSync(join(tmpdir(), "vibelang-corpus-labels-"))
    try {
      const tests = join(dir, "packages/compiler/test/eslint")
      mkdirSync(tests, { recursive: true })
      for (const file of ["corpus.test.mjs", "helpers.mjs", "tree.mjs", "config.mjs"]) {
        copyFileSync(join(here, file), join(tests, file))
      }
      // Copy optional oracle modules when composing independently landed fixes.
      for (const file of ["lint-oracle.mjs"]) {
        try { copyFileSync(join(here, file), join(tests, file)) }
        catch (error) { if (error.code !== "ENOENT") throw error }
      }
      symlinkSync(join(here, "node_modules"), join(tests, "node_modules"), "dir")
      symlinkSync(join(here, "node_modules"), join(dir, "node_modules"), "dir")
      symlinkSync(fileURLToPath(new URL("../../eslint.mjs", import.meta.url)), join(dir, "packages/compiler/eslint.mjs"))
      mkdirSync(join(dir, "samples"))
      writeFileSync(join(dir, "samples/main.vibe"), code)
      const env = { ...process.env }
      delete env.NODE_TEST_CONTEXT
      const run = spawnSync(process.execPath, [
        "--test", "--test-name-pattern=every .vibe file lints", join(tests, "corpus.test.mjs")
      ], { encoding: "utf8", env, timeout: 30_000 })
      assert.equal(run.status, 0, code + "\n" + run.stdout + run.stderr)
      assert.match(run.stdout, /pass 1\b/, "the selected real corpus test must execute")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
