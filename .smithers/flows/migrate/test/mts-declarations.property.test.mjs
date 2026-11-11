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

import { compare, check } from "./mts-declarations-oracle.mjs"
import { assertParallelProperty } from "../../../../scripts/testing/parallel-property.mjs"

test("foldkit mts: a renamed module's identical published declaration keeps its identity", () => {
  const result = compare(corpus.stem, corpus.before, corpus.after)
  assert.equal(result.identical, true)
  assert.deepEqual(result.removed, [])
  assert.deepEqual(result.added, [])
  assert.deepEqual(result.renamed, [{ from: corpus.stem + ".d.mts", to: corpus.stem + ".d.ts" }])
  assert.equal(result.publicSurface.rootsChanged, false)
})

test("mts pairing preserves API identity across paths and harmless printing changes", async () => {
  // Accepted .mts migration ruling: ".vibe, which emits .js, must emit ESM there".
  // The published entrypoint keeps its types across the declaration extension change.
  await assertParallelProperty(fc, {
    arbitraries: [fc.array(fc.stringMatching(/^[a-z][a-z0-9_-]{0,10}$/), { minLength: 1, maxLength: 4 }), fc.constantFrom("", "// changed comment\n", "type", "quote")],
    oracle: check, module: new URL("./mts-declarations-oracle.mjs", import.meta.url),
    seed: 190719, numRuns: 150
  })
})

test("file pairing does not bless collisions, while a stable public API can survive an internal move", () => {
  for (const options of [{ collision: true }, { pair: false }]) {
    const same = compare("feature", "export declare const value:string;", "export declare const value:string;", options)
    assert.equal(same.identical,true,JSON.stringify(same))
    assert.deepEqual(same.renamed,[])
    assert.deepEqual(same.removed,["feature.d.mts"])
    const changed=compare("feature", "export declare const value:string;", "export declare const value:number;", options)
    assert.equal(changed.comparisonComplete,true,JSON.stringify(changed))
    assert.equal(changed.identical,false,JSON.stringify(changed))
    assert.ok(changed.typeDifferences.length,JSON.stringify(changed))
  }
})

test("a renamed private declaration newly exposed through a package alias is still a public addition", () => {
  for (const options of [{ beforePublic: false }, { afterPublic: false }]) {
    const result = compare(corpus.stem, corpus.before, corpus.after, options)
    assert.equal(result.identical, false)
  }
})
