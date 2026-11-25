import assert from "node:assert/strict"
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

