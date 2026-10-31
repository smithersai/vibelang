import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import { test } from "node:test"
import { renameBatch, rewriteImports } from "../lib/codemod.mjs"
import { resolveRelative } from "../lib/imports.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const contract = readFileSync(new URL("../README.md", import.meta.url), "utf8")
const quote = "the codemod writes that name in every `.ts` importer"

const put = (root, path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}
const relative = (from, to) => {
  const path = posix.relative(posix.dirname(from), to)
  return path.startsWith(".") ? path : "./" + path
}

// Smithers run 2, batch 01 (capability): .smithers/flows/test/coding-builtin-routes.test.ts
// imports agent/fs/src/Command.ts, which Smithers' own 0.0.8 migration made
// Command.vibe long before. The capability batch renamed neither, so the test
// keeps its specifier.
test("smithers run 2: an importer of an earlier migration's .vibe module keeps its specifier", () => {
  assert.ok(contract.includes(quote), "update the quoted importer contract")
  const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-stale-vibe-importer.json", import.meta.url), "utf8"))
  const root = mkdtempSync(join(tmpdir(), "migrate-import-scope-"))
  try {
    for (const [path, text] of Object.entries(corpus.files)) put(root, path, text)
    const renames = renameBatch(root, corpus.batch)
    const scope = Object.keys(corpus.files).map((f) => (corpus.batch.includes(f) ? f.replace(/\.ts$/, ".vibe") : f))
    const edits = rewriteImports(root, scope, renames.map((r) => r.to))
    assert.deepEqual(edits.map((e) => `${e.file}: ${e.from} -> ${e.to}`), corpus.expected)
    for (const [path, text] of Object.entries(corpus.files)) {
      if (!corpus.batch.includes(path) && !corpus.expected.some((e) => e.startsWith(path + ":"))) assert.equal(readFileSync(join(root, path), "utf8"), text, path)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// Modules, some already .vibe, importers naming them by .ts or .js, and a
// batch that renames some of the .ts ones: an edit is only ever in a renamed
// module or of an import of one, and every .ts importer of a renamed module
// names it as x.vibe.
test("rewriteImports with a batch's renames edits only imports of and in the renamed modules", () => {
  const module = fc.record({ dir: fc.constantFrom("src", "src/internal", "test", "other/src"), vibe: fc.boolean() })
  const graph = fc.record({
    modules: fc.array(module, { minLength: 2, maxLength: 7 }),
    imports: fc.array(fc.record({ from: fc.nat(), to: fc.nat(), ext: fc.constantFrom(".ts", ".js") }), { maxLength: 14 }),
    batch: fc.array(fc.boolean(), { minLength: 7, maxLength: 7 })
  })
  fc.assert(fc.property(graph, ({ modules, imports, batch }) => {
    const root = mkdtempSync(join(tmpdir(), "migrate-import-scope-"))
    try {
      const paths = modules.map((m, i) => `${m.dir}/m${i}${m.vibe ? ".vibe" : ".ts"}`)
      const texts = paths.map(() => [])
      for (const { from, to, ext } of imports) {
        const a = from % paths.length
        const b = to % paths.length
        if (a === b) continue
        texts[a].push(`import { v as v${texts[a].length} } from "${relative(paths[a], paths[b].replace(/\.(?:ts|vibe)$/, ext))}"`)
      }
      paths.forEach((path, i) => put(root, path, texts[i].join("\n") + "\nexport const v = 1\n"))
      const files = paths.filter((p, i) => p.endsWith(".ts") && batch[i])
      const renames = renameBatch(root, files)
      const moved = new Set(renames.map((r) => r.to))
      const scope = paths.map((p) => (files.includes(p) ? p.replace(/\.ts$/, ".vibe") : p))
      const edits = rewriteImports(root, scope, [...moved])
      const all = new Set(scope)
      for (const e of edits) assert.ok(moved.has(e.file) || moved.has(resolveRelative(e.file, e.from, all)), `${e.file}: ${e.from} was edited`)
      for (const file of scope.filter((f) => f.endsWith(".ts"))) {
        for (const line of readFileSync(join(root, file), "utf8").split("\n")) {
          const specifier = /from "(.+)"/.exec(line)?.[1]
          if (specifier && moved.has(resolveRelative(file, specifier, all))) assert.ok(specifier.endsWith(".vibe"), `${file}: ${specifier}`)
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }), { seed: 31104, numRuns: 150 })
})
