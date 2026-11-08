import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"

const entries = [
  ["companion", fileURLToPath(new URL("../bin/vibelang-format", import.meta.url)), []],
  ["compiler", fileURLToPath(new URL("../bin/vibelang", import.meta.url)), ["format"]],
]
const input = "export   const   value=1;\n"
function project(action) {
  const dir = mkdtempSync(join(tmpdir(), "vibe-format-arguments-"))
  mkdirSync(join(dir, ".jj"))
  writeFileSync(join(dir, "existing.vibe"), input)
  try { action(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}
const run = (entry, dir, args) => spawnSync(process.execPath, [entry[1], ...entry[2], ...args], {
  cwd: dir, encoding: "utf8", env: { ...process.env, VIBELANG_DISABLE_CACHE: "1" },
})

for (const entry of entries) {
  test(entry[0] + " formatter preserves adjacent schemas and written alias documentation", () => project(dir => {
    const source = "import { Schema } from 'effect';\n/** Value docs. */ export schema Message { id: string } /** Type docs. */ export type Message = typeof Message.Type\n"
    writeFileSync(join(dir, "existing.vibe"), source)
    const result = run(entry, dir, ["--write", "existing.vibe"])
    assert.equal(result.status, 0, result.stderr)
    const formatted = readFileSync(join(dir, "existing.vibe"), "utf8")
    assert.ok(formatted.includes("schema Message"), formatted)
    assert.ok(formatted.includes("type Message = typeof Message.Type"), formatted)
    for (const comment of ["/** Value docs. */", "/** Type docs. */"]) assert.equal(formatted.split(comment).length, 2, formatted)
    const checked = run(entry, dir, ["--check", "existing.vibe"])
    assert.equal(checked.status, 0, checked.stderr)
    const again = run(entry, dir, ["--write", "existing.vibe"])
    assert.equal(again.status, 0, again.stderr)
    assert.equal(readFileSync(join(dir, "existing.vibe"), "utf8"), formatted)
  }))

  test(entry[0] + " formatter help describes modes and the option terminator without writing", () => project(dir => {
    for (const flag of ["--help", "-h"]) {
      const help = run(entry, dir, [flag])
      assert.equal(help.status, 0, help.stderr)
      assert.match(help.stdout, /--check/)
      assert.match(help.stdout, /--write/)
      assert.match(help.stdout, /--\s+Treat/)
      assert.equal(readFileSync(join(dir, "existing.vibe"), "utf8"), input)
    }
  }))

  test(entry[0] + " formatter rejects an unknown option and conflicting modes", () => project(dir => {
    for (const args of [["--chekc"], ["--write", "--check"], ["--check", "--write"]]) {
      const result = run(entry, dir, args)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /unknown option|cannot combine/)
      assert.match(result.stderr, /--help/)
      assert.equal(readFileSync(join(dir, "existing.vibe"), "utf8"), input)
    }
  }))

  test(entry[0] + " formatter reports missing files and unmatched explicit globs before writing", () => project(dir => {
    for (const missing of ["absent.vibe", "missing/**/*.vibex"]) {
      const result = run(entry, dir, ["--write", "existing.vibe", missing])
      assert.notEqual(result.status, 0)
      assert.ok(result.stderr.includes(missing), result.stderr)
      assert.match(result.stderr, /no files match/i)
      assert.equal(readFileSync(join(dir, "existing.vibe"), "utf8"), input)
    }
  }))

  test(entry[0] + " formatter keeps explicitly ignored existing files unchanged", () => project(dir => {
    for (const folder of ["node_modules", "dist"]) {
      mkdirSync(join(dir, folder), { recursive: true })
      const path = join(folder, "ignored.vibe")
      writeFileSync(join(dir, path), input)
      for (const file of [path, join(dir, path)]) {
        const result = run(entry, dir, ["--write", file])
        assert.equal(result.status, 0, result.stderr)
        assert.equal(readFileSync(join(dir, path), "utf8"), input)
        assert.equal(readFileSync(join(dir, "existing.vibe"), "utf8"), input)
      }
    }
  }))

  test(entry[0] + " formatter accepts an empty default scan and mode-like filenames after --", () => project(dir => {
    rmSync(join(dir, "existing.vibe"))
    assert.equal(run(entry, dir, ["--check"]).status, 0)
    writeFileSync(join(dir, "--check.vibe"), input)
    const formatted = run(entry, dir, ["--write", "--", "--check.vibe"])
    assert.equal(formatted.status, 0, formatted.stderr)
    assert.equal(readFileSync(join(dir, "--check.vibe"), "utf8"), "export const value = 1\n")
  }))
}

test("unknown option mutations never silently succeed or rewrite source", () => project(dir => {
  fc.assert(fc.property(
    fc.constantFrom(...entries), fc.constantFrom("--chekc", "--unknown", "--print-width=80", "-w", "--CHECK"),
    fc.constantFrom([], ["existing.vibe"]),
    (entry, flag, paths) => {
      const result = run(entry, dir, [flag, ...paths])
      assert.notEqual(result.status, 0)
      assert.ok(result.stderr.includes(flag), result.stderr)
      assert.equal(readFileSync(join(dir, "existing.vibe"), "utf8"), input)
    },
  ), { numRuns: 30 })
}))

test("missing path mutations are validated before either mode can change a file", () => project(dir => {
  fc.assert(fc.property(
    fc.constantFrom(...entries), fc.constantFrom("--check", "--write"),
    fc.stringMatching(/^[a-z]{1,10}$/), fc.constantFrom(".vibe", ".vibex", ".tsx", "/**/*.vibe"),
    (entry, mode, name, suffix) => {
      const missing = "missing-" + name + suffix
      const result = run(entry, dir, [mode, "existing.vibe", missing])
      assert.notEqual(result.status, 0)
      assert.ok(result.stderr.includes(missing), result.stderr)
      assert.equal(readFileSync(join(dir, "existing.vibe"), "utf8"), input)
    },
  ), { numRuns: 30 })
}))
