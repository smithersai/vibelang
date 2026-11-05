import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { rewriteSourceLiterals } from "../lib/source-paths.mjs"
import { prepareState } from "../lib/codemod-state.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-source-reference-boundary.json", import.meta.url)))
const renames = [{ from: corpus.module, to: corpus.native }]
const inventory = ["package.json", corpus.module, corpus.native]
const options = { inventory, selectors: true }
const unchanged = (file, text, api = ts) => {
  const result = rewriteSourceLiterals(api, text, file, renames, options)
  assert.equal(result.text, text, file)
  assert.deepEqual(result.edits, [], file)
  assert.deepEqual(result.warnings, [], file)
  assert.deepEqual(result.selectorChecks, [], file)
}
// The flow's source-only boundary preserves unrelated text and fixture oracles.
// The same filename spelling remains eligible in actual source/configuration.
test("source references: Alchemy documentation and corpus inputs remain byte-identical", () => {
  for (const [file, text] of Object.entries({ ...corpus.documents, ...corpus.fixtures })) unchanged(file, text)
})
test("source references: unsupported documents and declaration outputs never enter the TypeScript parser", () => {
  const api = new Proxy(ts, { get(target, key) {
    if (key === "createSourceFile") return () => { throw new Error("unrelated input reached the parser") }
    return Reflect.get(target, key)
  } })
  for (const file of ["README.md", "guide.mdx", "notes.txt", "diagram.svg", "lock.lock", "src/Entry.d.ts", "src/Entry.d.vibe.ts", ".vibelang/corpus/input.json", "test/fixtures/input.json"]) {
    unchanged(file, 'const entry = "src/Entry.ts";', api)
  }
})
test("source references: source and configuration controls still follow a renamed entry", () => {
  for (const file of ["entry.ts", "entry.tsx", "entry.js", "entry.mjs", "entry.cjs", "entry.mts", "entry.cts", "entry.vibe", "entry.vibex"]) {
    const result = rewriteSourceLiterals(ts, 'const entry = "src/Entry.ts";', file, renames, options)
    assert.equal(result.text, 'const entry = "src/Entry.vibe";', file)
    assert.equal(result.edits.length, 1, file)
  }
  for (const file of ["wrangler.json", "wrangler.jsonc"]) {
    const result = rewriteSourceLiterals(ts, '{"main":"src/Entry.ts"}', file, renames, options)
    assert.equal(result.text, '{"main":"src/Entry.vibe"}', file)
    assert.equal(result.edits.length, 1, file)
  }
})
test("source references: a broad durable catalog leaves documentation and corpus bytes outside its writes", () => {
  const root = mkdtempSync(join(tmpdir(), "alchemy-reference-boundary-"))
  const files = { "package.json": '{"type":"module"}', [corpus.module]: "export const value = 1;\n", ...corpus.documents, ...corpus.fixtures }
  try {
    for (const [file, text] of Object.entries(files)) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
    const state = prepareState(root, [corpus.module], [corpus.module], { ts, references: Object.keys(files), referenceFiles: Object.keys(files), catalog: Object.keys(files), plainGroups: [] })
    const protectedFiles = new Set(Object.keys({ ...corpus.documents, ...corpus.fixtures }))
    assert.deepEqual(state.writes.filter(w => protectedFiles.has(w.file)), [])
    for (const [file, text] of Object.entries(files)) assert.equal(readFileSync(join(root, file), "utf8"), text)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test("source references: keyed properties keep prose/data inert while source controls still migrate", () => {
  fc.assert(fc.property(
    fc.constantFrom(".md", ".mdx", ".txt", ".svg", ".lock"),
    fc.string({ maxLength: 40 }), fc.boolean(),
    (extension, prefix, json) => {
      const text = json ? JSON.stringify({ description: prefix, entry: corpus.module }) : prefix + '\nconst entry = "src/Entry.ts";\n'
      unchanged("docs/input" + extension, text)
      unchanged(".vibelang/corpus/input.json", JSON.stringify({ prefix, entry: corpus.module }))
      const control = rewriteSourceLiterals(ts, 'const entry = "src/Entry.ts";', "entry.ts", renames, options)
      assert.equal(control.text, 'const entry = "src/Entry.vibe";')
    }), { seed: 512278, numRuns: 240 })
})
