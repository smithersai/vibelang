import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"

const entries = [
  [fileURLToPath(new URL("../bin/vibelang-format", import.meta.url)), []],
  [fileURLToPath(new URL("../bin/vibelang", import.meta.url)), ["format"]],
]
function project(action) {
  const root = mkdtempSync(join(tmpdir(), "vibe-format-cache-kind-"))
  mkdirSync(join(root, ".jj"))
  try { action(root) } finally { rmSync(root, { recursive: true, force: true }) }
}
function run(root, entry, args, cold = false) {
  const env = { ...process.env, VIBELANG_CACHE_DIR: join(root, ".cache") }
  delete env.VIBELANG_DISABLE_CACHE
  if (cold) env.VIBELANG_DISABLE_CACHE = "1"
  return spawnSync(process.execPath, [entry[0], ...entry[1], ...args], { cwd: root, encoding: "utf8", env })
}
function compare(root, entry, file, text) {
  writeFileSync(join(root, "plain.vibe"), text)
  for (const mode of ["--write", "--check"]) {
    const prepared = run(root, entry, [mode, "plain.vibe"])
    assert.equal(prepared.status, 0, prepared.stderr)
  }
  const formatted = readFileSync(join(root, "plain.vibe"), "utf8")
  writeFileSync(join(root, file), formatted)
  const cold = run(root, entry, ["--check", file], true)
  assert.notEqual(cold.status, 0)
  assert.match(cold.stderr, /JSX|closing tag/)
  const cached = run(root, entry, ["--check", file])
  assert.equal(cached.status, cold.status, cached.stderr)
  assert.equal(cached.stderr, cold.stderr)
  assert.equal(readFileSync(join(root, file), "utf8"), formatted)
}

test("a clean plain-file cache never suppresses a JSX syntax error", () => {
  for (const entry of entries) project(root => compare(root, entry, "view.vibex", "export const value = <number> 1\n"))
})

test("source-kind cache mutations agree with disabled-cache checks", () => {
  fc.assert(fc.property(
    fc.constantFrom(...entries), fc.constantFrom("view.vibex", "marked.tsx"),
    fc.constantFrom("number", "unknown", "Array<number>"), fc.integer({ min: -1000, max: 1000 }),
    (entry, file, type, value) => project(root => {
      compare(root, entry, file, "// @vibe\nexport const value = <" + type + "> " + value + "\n")
    }),
  ), { numRuns: 24 })
})

test("both source kinds still check clean when their shared text is valid", () => {
  for (const entry of entries) project(root => {
    for (const file of ["plain.vibe", "view.vibex", "marked.tsx"]) {
      writeFileSync(join(root, file), "// @vibe\nexport const value = 1\n")
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = run(root, entry, ["--check", file])
        assert.equal(result.status, 0, result.stderr)
      }
    }
  })
})
