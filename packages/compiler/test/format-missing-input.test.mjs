import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"
const compiler = fileURLToPath(new URL("../", import.meta.url))
const cli = join(compiler, "bin/vibelang")
const standalone = join(compiler, "bin/vibelang-format")
function run(root, args, separate = false) {
  return spawnSync(process.execPath, [separate ? standalone : cli, ...(separate ? [] : ["format"]), ...args], { cwd: root, encoding: "utf8", timeout: 20000 })
}
test("explicit missing formatting inputs fail before changing any file", () => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-format-missing-"))
  try {
    const source = "export   const answer=42;\n"
    writeFileSync(join(root, "present.vibe"), source)
    for (const separate of [false, true]) {
      for (const mode of ["--write", "--check"]) {
        for (const input of ["absent.vibe", "absent.vibex", "missing/**/*.vibe"]) {
          const result = run(root, [mode, "present.vibe", input], separate)
          assert.notEqual(result.status, 0, JSON.stringify({ mode, input, separate }))
          assert.match(result.stderr, /no files match/)
          assert.ok(result.stderr.includes(input), result.stderr)
          assert.equal(readFileSync(join(root, "present.vibe"), "utf8"), source)
        }
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test("unmatched formatting globs and filenames never report success", () => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-format-missing-property-"))
  try {
    fc.assert(fc.property(
      fc.array(fc.constantFrom("a", "z", " ", "é", "-"), { minLength: 1, maxLength: 12 }),
      fc.constantFrom(".vibe", ".vibex", "/*.vibe", "/**/*.vibex"),
      fc.boolean(),
      (letters, suffix, check) => {
        const input = "missing-" + letters.join("") + suffix
        const result = run(root, [check ? "--check" : "--write", input])
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /no files match/)
        assert.deepEqual(readdirSync(root), [])
      }
    ), { numRuns: 32 })
    assert.equal(run(root, ["--check"]).status, 0, "default discovery can find no source files")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

