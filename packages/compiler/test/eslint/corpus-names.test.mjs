// Run the actual corpus oracle in a tiny checkout, with the real native
// exporter, scope manager and pinned ESLint rules. User dollar names are
// deliberate hygiene witnesses, not evidence of compiler-generated code.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const here = fileURLToPath(new URL(".", import.meta.url))
const cases = [
  ["top-level", "const $assertMatch = 1"],
  ["nested", "export function f() { const $freeze = 2; return 1 }"],
  ["parameter", "export function f($caught: number) { return 1 }"],
  ["import", 'import { value as $match1 } from "./other.ts"'],
  ["escaped", "const $fr" + "\\u0065" + "eze = 2"],
  ["shadowed", "const $assertMatch = 1; export function f() { const $assertMatch = 2; return 1 }"]
]

test("the real corpus accepts six shapes of written dollar names", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-corpus-names-"))
  try {
    const tests = join(dir, "packages/compiler/test/eslint")
    mkdirSync(tests, { recursive: true })
    for (const file of ["corpus.test.mjs", "helpers.mjs", "tree.mjs", "config.mjs", "lint-oracle.mjs"]) {
      copyFileSync(join(here, file), join(tests, file))
    }
    symlinkSync(join(here, "node_modules"), join(tests, "node_modules"), "dir")
    symlinkSync(join(here, "node_modules"), join(dir, "node_modules"), "dir")
    symlinkSync(fileURLToPath(new URL("../../eslint.mjs", import.meta.url)), join(dir, "packages/compiler/eslint.mjs"))
    mkdirSync(join(dir, "samples"))
    for (const [name, code] of cases) writeFileSync(join(dir, "samples", name + ".vibe"), code)
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const started = performance.now()
    const run = spawnSync(process.execPath, [
      "--test", "--test-name-pattern=every .vibe file lints", join(tests, "corpus.test.mjs")
    ], { encoding: "utf8", env, timeout: 60_000 })
    const result = JSON.stringify({ status: run.status, signal: run.signal,
      error: run.error?.code, elapsedMs: Math.round(performance.now() - started) })
    assert.equal(run.status, 0, result + "\n" + run.stdout + run.stderr)
    assert.match(run.stdout, /pass 1\b/, "the selected real corpus test must execute")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
