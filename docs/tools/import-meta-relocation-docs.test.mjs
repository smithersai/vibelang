import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { test } from "node:test"
import fc from "fast-check"
import { checkImportMetaRelocationDocs, importMetaRelocationProblems } from "./import-meta-relocation-docs.mjs"

const stale = "Code that reads `import.meta.filename` or `import.meta.dirname` never moves into the companion itself, where it would name the companion."

test("platform guides distinguish a shared directory from the entry file identity", () => {
  assert.deepEqual(checkImportMetaRelocationDocs(), [])
})

test("the stale metadata rule remains detectable across Markdown spacing", () => {
  fc.assert(fc.property(fc.constantFrom(" ", "\t", "\n", " \n "), gap => {
    assert.equal(importMetaRelocationProblems(stale.replaceAll(" ", gap)).length, 1)
    assert.deepEqual(importMetaRelocationProblems("Code that reads `import.meta.filename` stays at the entry; `import.meta.dirname` can move to a sibling in the same directory."), [])
  }), { seed: 520052, numRuns: 100 })
})

test("generated sibling modules share their directory while retaining distinct filenames", async () => {
  const root = mkdtempSync(join(tmpdir(), "import-meta-directory-"))
  const segment = fc.array(fc.constantFrom("a", "b", "0", "_", "-"), { minLength: 1, maxLength: 8 }).map(chars => "d" + chars.join(""))
  let count = 0
  try {
    await fc.assert(fc.asyncProperty(segment, fc.array(segment, { maxLength: 3 }), async (stem, parts) => {
      const dir = join(root, "case" + (++count), ...parts)
      mkdirSync(dir, { recursive: true })
      const entry = join(dir, stem + ".mjs"), companion = join(dir, stem + ".platform.mjs")
      const text = "export const directory = import.meta.dirname; export const filename = import.meta.filename;\n"
      writeFileSync(entry, text); writeFileSync(companion, text)
      const before = await import(pathToFileURL(entry).href)
      const after = await import(pathToFileURL(companion).href)
      assert.equal(before.directory, after.directory)
      assert.equal(typeof before.directory, "string")
      assert.notEqual(before.filename, after.filename)
    }), { seed: 520053, numRuns: 200 })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
