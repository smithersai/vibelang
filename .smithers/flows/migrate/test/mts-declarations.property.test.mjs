import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { compareDeclarations } from "../lib/declarations.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-mts-declaration-pairing.json", import.meta.url), "utf8"))

function compare(stem, before, after, { collision = false, pair = true, beforePublic = true, afterPublic = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "migrate-mts-dts-"))
  try {
    const oldName = stem + ".d.mts"
    const newName = stem + ".d.ts"
    const put = (dir, file, text) => {
      mkdirSync(join(root, dir, file, ".."), { recursive: true })
      writeFileSync(join(root, dir, file), text)
    }
    put("before", oldName, before)
    if (collision) put("before", newName, after)
    put("after", pair ? newName : "other.d.ts", after)
    for (const [dir, name, published] of [["before", oldName, beforePublic], ["after", pair ? newName : "other.d.ts", afterPublic]]) {
      const entry = "__published_entry__.d.ts"
      put(dir, entry, "export {};\n")
      put(dir, "public-surface.json", JSON.stringify({ roots: [entry], reachable: [entry, ...(published ? [name] : [])], unresolved: [] }))
    }
    return compareDeclarations(ts, join(root, "before"), join(root, "after"))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("foldkit mts: a renamed module's identical published declaration keeps its identity", () => {
  const result = compare(corpus.stem, corpus.before, corpus.after)
  assert.equal(result.identical, true)
  assert.deepEqual(result.removed, [])
  assert.deepEqual(result.added, [])
  assert.deepEqual(result.renamed, [{ from: corpus.stem + ".d.mts", to: corpus.stem + ".d.ts" }])
  assert.equal(result.publicSurface.rootsChanged, false)
})

test("mts pairing preserves the public byte gate across paths and byte mutations", () => {
  // Accepted .mts migration ruling: ".vibe, which emits .js, must emit ESM there".
  // Filename pairing preserves module identity; published declaration bytes still must match.
  fc.assert(fc.property(
    fc.array(fc.stringMatching(/^[a-z][a-z0-9_-]{0,10}$/), { minLength: 1, maxLength: 4 }),
    fc.constantFrom("", "// changed comment\n", "type", "quote"),
    (parts, mutation) => {
      const before = 'export declare const answer: "yes" | "no";\n'
      const after = mutation === "type" ? 'export declare const answer: number;\n'
        : mutation === "quote" ? "export declare const answer: 'yes' | 'no';\n" : mutation + before
      const result = compare(parts.join("/"), before, after)
      assert.equal(result.identical, mutation === "")
      assert.deepEqual(result.added, [])
      assert.deepEqual(result.removed, [])
      if (mutation) assert.deepEqual(result.changed.map(x => x.file), [parts.join("/") + ".d.mts"])
    }), { seed: 190719, numRuns: 150 })
})

test("an existing destination or a different module never hides a removed mts declaration", () => {
  for (const options of [{ collision: true }, { pair: false }]) {
    const result = compare(corpus.stem, corpus.before, corpus.after, options)
    assert.equal(result.identical, false)
    assert.deepEqual(result.removed, [corpus.stem + ".d.mts"])
  }
})

test("a renamed private declaration newly exposed through a package alias is still a public addition", () => {
  for (const options of [{ beforePublic: false }, { afterPublic: false }]) {
    const result = compare(corpus.stem, corpus.before, corpus.after, options)
    assert.equal(result.identical, false)
  }
})
