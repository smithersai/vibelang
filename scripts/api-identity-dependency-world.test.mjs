// An unchanged package can be compared only against one dependency tree. A
// dependency on its sources on one side and its emitted headers on the other
// is a changed dependency, so the deferred exports that reach it are reported,
// and the comparison stays complete. Moving both snapshots onto either tree
// makes the same package identical, which is the check a migration runs.
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { createEs5FixtureGuard } from "./testing/fixture-libraries.mjs"
import { checkProperty } from "./testing/property.mjs"

const es5 = createEs5FixtureGuard(loadTypeScript(), "Dependency world fixtures")
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/t3code-core-dependency-world.json", import.meta.url), "utf8"))
const contract = readFileSync(new URL("../docs/maintainers/api-identity.md", import.meta.url), "utf8")

function compare(before, after) {
  const root = mkdtempSync(join(tmpdir(), "api-dependency-world-"))
  try {
    for (const [side, files] of [["before", before], ["after", after]])
      for (const [name, text] of Object.entries(files)) {
        const path = join(root, side, name)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, text)
      }
    const entries = { index: "index.d.ts" }
    const result = compareApiIdentity(es5.ts, join(root, "before"), join(root, "after"),
      { beforeEntrypoints: entries, afterEntrypoints: entries, compilerOptions: { lib: ["lib.es5.d.ts"], strict: true, types: [] } })
    es5.assertLibraries()
    return result
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const headers = {
  "node_modules/dep/package.json": JSON.stringify(corpus.manifest),
  "node_modules/dep/index.d.ts": corpus.declarations,
}
const sources = {
  "node_modules/dep/package.json": JSON.stringify(corpus.sourceManifest),
  "node_modules/dep/index.ts": corpus.sources,
}
const reported = result => result.typeDifferences.map(d => [d.export, d.mutuallyAssignable])
const throwsComment = "/** @throws {never} */\n"

test("docs state that a changed dependency invalidates the proof", () => {
  assert.match(contract, /A changed dependency\s+invalidates that proof\./)
})

test("t3code Core shape: a dependency on sources against its headers is reported, and stays complete", () => {
  const result = compare({ "index.d.ts": corpus.consumer, ...sources }, { "index.d.ts": corpus.consumer, ...headers })
  assert.equal(result.comparisonComplete, true)
  assert.equal(result.identical, false)
  assert.deepEqual(reported(result), [["Use", true], ["read", true]])
})

for (const [label, tree] of [["headers", headers], ["sources", sources]])
  test(`one dependency tree (${label}): generated comments in the package keep it identical`, () => {
    const result = compare({ "index.d.ts": corpus.consumer, ...tree }, { "index.d.ts": throwsComment + corpus.consumer, ...tree })
    assert.equal(result.comparisonComplete, true)
    assert.equal(result.identical, true, JSON.stringify(reported(result)))
  })

test("one dependency tree: a real change to the package is still reported", () => {
  const changed = corpus.consumer.replace("export type Use<C> = Elem<C>;", "export type Use<C> = Elem<C> | undefined;")
  const result = compare({ "index.d.ts": corpus.consumer, ...headers }, { "index.d.ts": changed, ...headers })
  assert.equal(result.identical, false)
  assert.deepEqual(result.typeDifferences.map(d => d.export), ["Use"])
})

test("property: identical in one tree, reported across trees, for every deferred consumer form", async () => {
  const forms = [
    "export type F<C> = Elem<C>;\n",
    "export type F<C> = { readonly item: Elem<C> };\n",
    "export declare const F: <C>(c: C) => Elem<C>;\n",
    "export type F<C> = readonly [Elem<C>, C];\n",
    "export type F<C> = Elem<C> | null;\n",
  ]
  await checkProperty(fc, {
    name: "api-identity-dependency-world",
    rule: "A changed dependency invalidates that proof. Compare both snapshots of a package against one dependency tree.",
    command: "node --test scripts/api-identity-dependency-world.test.mjs",
    arbitrary: fc.record({ form: fc.constantFrom(...forms), tree: fc.constantFrom(headers, sources) }),
    numRuns: 12,
    check: ({ form, tree }) => {
      const consumer = 'import type { Elem } from "dep";\n' + form
      const same = compare({ "index.d.ts": consumer, ...tree }, { "index.d.ts": throwsComment + consumer, ...tree })
      assert.equal(same.identical, true, JSON.stringify(reported(same)))
      const across = compare({ "index.d.ts": consumer, ...sources }, { "index.d.ts": consumer, ...headers })
      assert.equal(across.comparisonComplete, true)
      assert.deepEqual(across.typeDifferences.map(d => d.export), ["F"])
    },
  })
})
