// Named negative fixtures still have to fail with their exact intended syntax
// error; do not exclude whole fixture trees or every case with diagnostics.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { repo } from "./helpers.mjs"

const here = fileURLToPath(new URL(".", import.meta.url))
const files = ["typescript/vibelang/cases/fiber-unary-exponentiation-error/main.vibe", "typescript/vibelang/lsp-fixture/src/malformed-pipe.vibe"]
function check(file, code, succeeds) {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-corpus-parse-errors-"))
  try {
    const tests = join(dir, "packages/compiler/test/eslint")
    mkdirSync(tests, { recursive: true })
    for (const name of ["corpus.test.mjs", "helpers.mjs", "tree.mjs", "config.mjs"]) copyFileSync(join(here, name), join(tests, name))
    for (const name of ["condition-oracle.mjs", "lint-oracle.mjs"]) {
      try { copyFileSync(join(here, name), join(tests, name)) }
      catch (error) { if (error.code !== "ENOENT") throw error }
    }
    symlinkSync(join(here, "node_modules"), join(tests, "node_modules"), "dir")
    symlinkSync(join(here, "node_modules"), join(dir, "node_modules"), "dir")
    symlinkSync(fileURLToPath(new URL("../../eslint.mjs", import.meta.url)), join(dir, "packages/compiler/eslint.mjs"))
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), code)
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const run = spawnSync(process.execPath, ["--test", "--test-name-pattern=every .vibe file (parses|lints)", join(tests, "corpus.test.mjs")], {
      encoding: "utf8", env, timeout: 30_000
    })
    assert.equal(run.status, succeeds ? 0 : 1, file + "\n" + code + "\n" + run.stdout + run.stderr)
    assert.match(run.stdout, succeeds ? /pass 2\b/ : /fail 2\b/, "both real corpus checks must execute")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
for (const file of files) {
  test("corpus verifies the deliberately invalid source: " + file, () => check(file, readFileSync(join(repo, file), "utf8"), true))
}

for (const file of files) {
  const code = readFileSync(join(repo, file), "utf8")
  test("corpus rejects a shifted syntax error: " + file, () => check(file, "\n" + code, false))
  test("corpus rejects a stale negative fixture that now parses: " + file, () => check(file, "export const valid = 1\n", false))
  test("corpus rejects the same error in an unlisted neighbouring file: " + file, () => check(file.replace(".vibe", "-neighbour.vibe"), code, false))
}
test("corpus rejects a different failure in a known negative fixture", () => {
  check(files[1], "const e = \"unterminated\n", false)
})
