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
const shapes = [["routes/[id]/page", "routes/i/page"], ["choice{a,b}", "choicea"], ["item[12]", "item1"]]
if (process.platform !== "win32") shapes.push(["star*", "star-other"], ["what?", "whatA"])
const run = (root, entry, args) => spawnSync(process.execPath, [entry[0], ...entry[1], ...args], {
  cwd: root, encoding: "utf8", env: { ...process.env, VIBELANG_DISABLE_CACHE: "1" },
})
const write = (root, file, text) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}
function project(action) {
  const root = mkdtempSync(join(tmpdir(), "vibe-format-literal-"))
  mkdirSync(join(root, ".jj"))
  try { action(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

test("an existing bracketed route path formats that file and leaves a glob-shaped neighbour untouched", () => {
  for (const entry of entries) project(root => {
    const file = "routes/[id]/page.vibe", neighbour = "routes/i/page.vibe"
    const input = "export   const   value=1;\n"
    write(root, file, input)
    write(root, neighbour, input)
    const checked = run(root, entry, ["--check", file])
    assert.equal(checked.status, 1, checked.stderr)
    assert.ok(checked.stderr.includes(file), checked.stderr)
    assert.ok(!checked.stderr.includes(neighbour), checked.stderr)
    const formatted = run(root, entry, ["--write", file])
    assert.equal(formatted.status, 0, formatted.stderr)
    assert.equal(readFileSync(join(root, file), "utf8"), "export const value = 1\n")
    assert.equal(readFileSync(join(root, neighbour), "utf8"), input)
  })
})

test("literal-path mutations preserve selection across extensions, names and absolute paths", () => {
  fc.assert(fc.property(
    fc.constantFrom(...entries), fc.constantFrom(...shapes),
    fc.constantFrom(".vibe", ".vibex", ".ts", ".tsx", ".mts", ".cts"),
    fc.boolean(), fc.integer({ min: 1, max: 8 }), fc.integer({ min: -1000, max: 1000 }),
    (entry, [literal, decoy], extension, absolute, spaces, value) => project(root => {
      const marker = extension.startsWith(".vibe") ? "" : "// @vibe\n"
      const input = marker + "export" + " ".repeat(spaces) + "const   value=" + value + ";\n"
      const file = literal + extension, neighbour = decoy + extension
      write(root, file, input)
      write(root, neighbour, input)
      const path = absolute ? join(root, file) : file
      const result = run(root, entry, ["--write", path])
      assert.equal(result.status, 0, result.stderr)
      assert.equal(readFileSync(join(root, file), "utf8"), marker + "export const value = " + value + "\n")
      assert.equal(readFileSync(join(root, neighbour), "utf8"), input)
      assert.equal(run(root, entry, ["--check", path]).status, 0)
    }),
  ), { numRuns: 30 })
})

test("a pattern with no literal file still expands, and ignored literal files stay ignored", () => {
  for (const entry of entries) project(root => {
    const input = "export   const   value=1;\n"
    for (const file of ["routes/[id]/page.vibe", "routes/i/page.vibe", "node_modules/[id]/page.vibe"]) write(root, file, input)
    const expanded = run(root, entry, ["--write", "routes/*/page.vibe"])
    assert.equal(expanded.status, 0, expanded.stderr)
    for (const file of ["routes/[id]/page.vibe", "routes/i/page.vibe"]) assert.equal(readFileSync(join(root, file), "utf8"), "export const value = 1\n")
    assert.equal(run(root, entry, ["--write", "node_modules/[id]/page.vibe"]).status, 0)
    assert.equal(readFileSync(join(root, "node_modules/[id]/page.vibe"), "utf8"), input)
  })
})
