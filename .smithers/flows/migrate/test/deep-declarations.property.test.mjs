import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { compareDeclarations, recordDeclarationSurface } from "../lib/declarations.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/cli-deep-declaration-gate.json", import.meta.url)))
const quote = "the same doc comment on each export"

import { trees, put, check } from "./deep-declarations-oracle.mjs"
import { assertParallelProperty } from "../../../../scripts/testing/parallel-property.mjs"

test("deep-declaration-gate: stock tsc accepts a shipped CLI deep import; removing its docs fails migration", () => {
  assert.equal(ts.version, "5.9.3")
  assert.ok(readFileSync(new URL("../../../../docs/design/src/001-functions.md", import.meta.url), "utf8").includes(quote))
  trees(corpus, ({ selected, importer, options, before, after }) => {
    assert.equal(selected, join(before, corpus.file))
    writeFileSync(importer, 'import type { X } from "cli/dist/internal.js"; const x: X = "a";\n')
    const program = ts.createProgram([importer], options)
    assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [])
    assert.equal(compareDeclarations(ts, before, after).identical, false)
  })
})

test("property: consumer-reachable deep declarations retain exported types and JSDoc, with and without a root entry", async () => {
  await assertParallelProperty(fc, {
    arbitraries: [fc.array(fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/), { minLength: 1, maxLength: 3 }), fc.constantFrom(".d.ts", ".d.mts", ".d.cts"), fc.boolean(), fc.boolean(), fc.boolean()],
    oracle: check, module: new URL("./deep-declarations-oracle.mjs", import.meta.url),
    seed: 270034, numRuns: 80
  })
})

test("deep-declaration-gate: snapshots retain shipped paths and do not publish excluded source declarations", () => {
  trees(corpus, ({ root, before, after }) => {
    const snapshots = []
    for (const [side, pkg] of [["before", before], ["after", after]]) {
      put(pkg, "src/internal.ts", "export type X = string;\n")
      put(pkg, "tsconfig.json", JSON.stringify({ compilerOptions: { rootDir: "src", outDir: "dist", declaration: true }, include: ["src"] }))
      const snapshot = join(root, "snapshot-" + side)
      put(snapshot, "internal.d.ts", readFileSync(join(pkg, corpus.file), "utf8"))
      recordDeclarationSurface(ts, snapshot, pkg, [{ tsconfig: "tsconfig.json", prefix: "." }])
      snapshots.push(snapshot)
    }
    assert.equal(compareDeclarations(ts, ...snapshots).identical, false)
  })
  const input = { ...corpus, file: "src/internal.d.ts", specifier: "cli/src/internal.js" }
  trees(input, ({ before, after }) => {
    // The source tree is absent from the published tarball, even though a
    // resolver pointed at the unpacked source repository could find it.
    assert.equal(compareDeclarations(ts, before, after).identical, true)
  })
})

test("deep-declaration-gate: an added shipped deep declaration is public", () => {
  trees({ ...corpus, after: corpus.before }, ({ before, after }) => {
    put(after, "dist/introduced.d.ts", "export {};\n")
    const result = compareDeclarations(ts, before, after)
    assert.equal(result.identical, false)
    assert.deepEqual(result.added, ["dist/introduced.d.ts"])
  })
})

test("deep-declaration-gate: handwritten deep declarations remain frozen in snapshots", () => {
  trees(corpus, ({ root, before, after }) => {
    const snapshots = []
    for (const [side, pkg] of [["before", before], ["after", after]]) {
      const snapshot = join(root, "shipped-" + side)
      mkdirSync(snapshot)
      const surface = recordDeclarationSurface(ts, snapshot, pkg, [])
      assert.ok(surface.roots.includes(".migrate-shipped/" + corpus.file))
      snapshots.push(snapshot)
    }
    put(before, corpus.file, corpus.after)
    assert.equal(compareDeclarations(ts, ...snapshots).identical, false)
  })
})

test("deep-declaration-gate: direct comparisons cannot trust an older incomplete public graph", () => {
  trees(corpus, ({ before, after }) => {
    for (const dir of [before, after]) put(dir, "public-surface.json", JSON.stringify({ snapshotVersion: 2, roots: [], reachable: [], unresolved: [] }))
    const result = compareDeclarations(ts, before, after)
    assert.equal(result.identical, false)
    assert.ok(result.environmentDiagnostics?.some(item => /Legacy|snapshot|entrypoint/.test(item.diagnostic)), JSON.stringify(result))
  })
})

test("deep-declaration-gate: complex packing allowlists cannot prove deep declarations private", () => {
  for (const pattern of ["@(dist)", "+(dist)", "dist/**"]) {
    trees({ ...corpus, manifest: { ...corpus.manifest, files: [pattern] } }, ({ before, after }) => {
      assert.equal(compareDeclarations(ts, before, after).identical, false, pattern)
    })
  }
})
