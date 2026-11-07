import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
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


test("existing excluded formatting inputs stay unchanged while missing neighbours fail", () => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-format-excluded-"))
  try {
    fc.assert(fc.property(
      fc.constantFrom("node_modules", "dist", "build", "coverage", ".git", ".jj"),
      fc.constantFrom("[id]", "with space", "深い"),
      fc.constantFrom(".vibe", ".vibex"),
      fc.boolean(), fc.boolean(), fc.boolean(),
      (directory, name, extension, absolute, check, separate) => {
        const relative = directory + "/" + name + extension
        const file = join(root, relative)
        const source = "export   const value=42;\n"
        mkdirSync(join(root, directory), { recursive: true })
        writeFileSync(file, source)
        const input = absolute ? file : relative
        const result = run(root, [check ? "--check" : "--write", input], separate)
        assert.equal(result.status, 0, result.stderr)
        assert.equal(readFileSync(file, "utf8"), source)
        const missing = run(root, ["--check", input + ".missing.vibe"], separate)
        assert.notEqual(missing.status, 0)
        assert.match(missing.stderr, /no files match/)
      }
    ), { numRuns: 16 })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
