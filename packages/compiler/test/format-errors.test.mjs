import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"

const entries = [
  [fileURLToPath(new URL("../bin/vibelang-format", import.meta.url)), []],
  [fileURLToPath(new URL("../bin/vibelang", import.meta.url)), ["format"]],
]
const broken = "export const value = ;\n"
const run = (dir, entry, args) => spawnSync(process.execPath, [entry[0], ...entry[1], ...args], {
  cwd: dir, encoding: "utf8", env: { ...process.env, VIBELANG_DISABLE_CACHE: "1" },
})

test("a syntax error identifies the original input among several selected files", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibe-format-errors-"))
  try {
    mkdirSync(join(dir, ".jj"))
    writeFileSync(join(dir, "first.vibe"), "export const first = 1\n")
    writeFileSync(join(dir, "broken.vibe"), broken)
    writeFileSync(join(dir, "last.vibe"), "export const last = 2\n")
    for (const entry of entries) for (const mode of ["--check", "--write"]) {
      const result = run(dir, entry, [mode, "first.vibe", "broken.vibe", "last.vibe"])
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /broken\.vibe: vibelang format: \d+:\d+: Expression expected/)
      assert.doesNotMatch(result.stderr, /\d{7}\.vibe/)
      assert.equal(readFileSync(join(dir, "broken.vibe"), "utf8"), broken)
      assert.equal(readFileSync(join(dir, "last.vibe"), "utf8"), "export const last = 2\n")
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("syntax error path, line and byte-preservation survive filename and source mutations", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibe-format-error-property-"))
  try {
    mkdirSync(join(dir, ".jj"))
    fc.assert(fc.property(
      fc.constantFrom(...entries), fc.constantFrom("--check", "--write"),
      fc.constantFrom("src/one.vibe", "space name.vibe", "unicode-é.vibe", "view.vibex"),
      fc.integer({ min: 0, max: 6 }),
      (entry, mode, file, lines) => {
        const text = "// retained\n".repeat(lines) + broken
        mkdirSync(dirname(join(dir, file)), { recursive: true })
        writeFileSync(join(dir, file), text)
        const result = run(dir, entry, [mode, file])
        assert.notEqual(result.status, 0)
        assert.ok(result.stderr.includes(file + ": vibelang format: " + (lines + 1) + ":"), result.stderr)
        assert.equal(readFileSync(join(dir, file), "utf8"), text)
      },
    ), { numRuns: 24 })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
