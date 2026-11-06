import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { parseSlice, selectedFiles, sliceFiles } from "./testing/migrate-slice.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const fc = createRequire(join(root, "packages/runtime/package.json"))("fast-check")
const files = ["migrate/test/b.test.mjs", "migrate/test/a.test.mjs", "convert/c.test.mjs"]

test("n slices run every file exactly once", () => {
  const names = fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}\.test\.mjs$/), { minLength: 1, maxLength: 40 })
  fc.assert(fc.property(names, fc.integer({ min: 1, max: 8 }), (list, count) => {
    const slices = Array.from({ length: count }, (_, i) => sliceFiles(list, { index: i + 1, count }))
    assert.deepEqual(slices.flat().sort(), [...list].sort())
    const sizes = slices.map(slice => slice.length)
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1)
  }), { seed: 5511, numRuns: 200 })
})

test("input order cannot change which slice owns a file", () => {
  const forward = sliceFiles(files, { index: 2, count: 2 })
  assert.deepEqual(sliceFiles([...files].reverse(), { index: 2, count: 2 }), forward)
})

test("the slice file applies only on the host it names", () => {
  assert.deepEqual(selectedFiles(files, undefined), files)
  assert.deepEqual(selectedFiles(files, "1/3 box\n", "box"), ["convert/c.test.mjs"])
  assert.deepEqual(selectedFiles(files, "1/3 box\n", "elsewhere"), files)
})

test("a malformed slice is refused", () => {
  for (const text of ["", "0/2 box", "3/2 box", "1 box", "a/b box", "1/2/3 box"]) assert.throws(() => parseSlice(text), /not i\/n/, text)
})

test("the command fails rather than run an unselected suite", () => {
  const dir = mkdtempSync(join(tmpdir(), "migrate-slice-"))
  try {
    mkdirSync(join(dir, "testing"))
    cpSync(join(root, "scripts/testing/migrate-slice.mjs"), join(dir, "testing/migrate-slice.mjs"))
    const run = (...args) => spawnSync(process.execPath, [join(dir, "testing/migrate-slice.mjs"), ...args], { encoding: "utf8" })
    assert.equal(run(...files).stdout.trim().split("\n").length, files.length)
    writeFileSync(join(dir, "migrate-test-slice"), "2/2 " + hostname() + "\n")
    assert.deepEqual(run(...files).stdout.trim().split("\n"), ["migrate/test/a.test.mjs"])
    writeFileSync(join(dir, "migrate-test-slice"), "9/2 " + hostname() + "\n")
    assert.equal(run(...files).status, 2)
    writeFileSync(join(dir, "migrate-test-slice"), "2/2 " + hostname() + "\n")
    assert.equal(run("only.test.mjs").status, 2, "an empty slice must not fall through to node --test's default glob")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("the target selects through the slice and stops when selection fails", () => {
  const declaration = readFileSync(join(root, "packages/PACKAGE.ts"), "utf8")
  assert.match(declaration, /files=\$\(node \.\.\/\.\.\/scripts\/testing\/migrate-slice\.mjs migrate\/test\/\*\.test\.mjs convert\/\*\.test\.mjs\) && node --test /)
  assert.ok(declaration.includes('S.file("//scripts/testing/migrate-slice.mjs")'))
})

test("no commit can carry a slice file", () => {
  assert.ok(readFileSync(join(root, ".gitignore"), "utf8").includes("/scripts/migrate-test-slice"))
})
