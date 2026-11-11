import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { compareDeclarations, recordDeclarationSurface } from "../lib/declarations.mjs"
import { check, prepare, put } from "./ambient-roots-oracle.mjs"
import { assertParallelProperty } from "../../../../scripts/testing/parallel-property.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-markdown-shipped-root.json", import.meta.url)))

test("foldkit-80: a shipped content root admits only genuinely private declaration additions", () => {
  // VIP-27/007 ruling: "Resolving shipped hand-written roots against the package tree and following their declaration dependencies".
  for (const input of corpus.cases) check(input)
})
test("handwritten-root resolution follows TypeScript file-before-directory priority and preserves APIs", async () => {
  await assertParallelProperty(fc, { arbitraries: [fc.record({
    folder: fc.tuple(fc.constantFrom("feature", "vite", "api"), fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/)).map(([a,b]) => a + "/" + b),
    form: fc.constantFrom("star", "namespace", "type"),
    addition: fc.constantFrom("private", "shadow"), changed: fc.boolean()
  })], oracle: check, module: new URL("./ambient-roots-oracle.mjs", import.meta.url), seed: 800081, numRuns: 120 })
})
test("matching unresolved legacy roots cannot prove a new declaration private", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-unresolved-safe-"))
  try {
    for (const dir of ["before", "after"]) {
      put(root, dir + "/index.d.ts", "export {};\n")
      put(root, dir + "/public-surface.json", JSON.stringify({ roots: ["index.d.ts"], reachable: ["index.d.ts"], unresolved: ["./content.d.ts"] }))
    }
    put(root, "after/private.d.ts", "export {};\n")
    const result = compareDeclarations(ts, join(root,"before"), join(root,"after"))
    assert.equal(result.identical, false)
    assert.deepEqual(result.addedPrivate, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test("a supplied historical declaration snapshot never borrows the candidate package bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-historical-root-"))
  try {
    const prepared = prepare(root, "before")
    const old = 'export * from "./dist/feature";\n'
    put(prepared.pkg, "content.d.ts", "export interface LeakedCandidate {}\n")
    const surface = recordDeclarationSurface(ts, prepared.snapshot, prepared.pkg, [{tsconfig:"tsconfig.json",prefix:"."}], undefined, { handwritten: new Map([["content.d.ts", old]]) })
    assert.deepEqual(surface.unresolved, [])
    assert.equal(readFileSync(join(prepared.snapshot, ".migrate-shipped/content.d.ts"), "utf8"), old)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
