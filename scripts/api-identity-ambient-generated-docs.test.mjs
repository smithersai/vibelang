import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"

const ts = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/t3code-ambient-generated-docs.json", import.meta.url)))
const quote = "the emitted declaration may add VIP-27’s generated `@throws {never}` contract where the twin has no authored throw contract."
const options = { lib: ["lib.es5.d.ts"], types: [], strict: true, noEmit: true, skipLibCheck: false,
  target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext }
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
function compare(before, after, lazyAmbientDocumentation = false) {
  const root = mkdtempSync(join(tmpdir(), "api-ambient-generated-docs-"))
  try {
    for (const [side, text] of Object.entries({ before, after })) {
      const base = join(root, side)
      put(join(base, "package.json"), '{"type":"module","types":"index.d.ts"}')
      put(join(base, "index.d.ts"), text)
      put(join(base, "node_modules/effect/package.json"), '{"name":"effect","version":"4.1.1","type":"module","exports":{"./Schema":{"types":"./Schema.d.ts"}}}')
      put(join(base, "node_modules/effect/Schema.d.ts"), "export namespace Annotations { export interface Annotations {} }")
      const program = ts.createProgram([join(base, "index.d.ts")], options)
      assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [], "Each declaration snapshot must be stock-valid")
    }
    return compareApiIdentity(ts, join(root, "before"), join(root, "after"),
      { compilerOptions: options, lazyAmbientDocumentation })
  } finally { rmSync(root, { recursive: true, force: true }) }
}
function identical(result) {
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, true, JSON.stringify(result))
  assert.deepEqual(result.docDifferences, [])
}
function unequal(result) {
  assert.equal(result.identical, false, JSON.stringify(result))
  assert.ok(result.docDifferences.length || result.typeDifferences.length || result.environmentDiagnostics.some(x => x.blocking),
    JSON.stringify(result))
}

test("ambient generated-documentation rule is quoted from Chapter 1", () => {
  assert.ok(readFileSync(new URL("../docs/design/src/001-functions.md", import.meta.url), "utf8").includes(quote))
})
for (const lazy of [false, true]) {
  test("generated never contracts preserve ambient closure identity, lazy=" + lazy, () => {
    identical(compare(corpus.before, corpus.after, lazy))
  })
}
test("authored throws, prose and duplicate generated contracts remain strict in ambient closures", () => {
  const authored = corpus.before.replace("export declare function helper", "/** @throws {Error} */\nexport declare function helper")
  for (const after of [corpus.before, corpus.after, authored.replace("Error", "TypeError")]) unequal(compare(authored, after))
  const documented = corpus.before.replace("export declare function helper", "/** Preserve this description. */\nexport declare function helper")
  unequal(compare(documented, corpus.after))
  unequal(compare(corpus.before, corpus.after.replace("@throws {never}", "@throws {never}\n * @throws {never}")))
  unequal(compare(corpus.before, corpus.after.replace("@throws {never}", "@throws {unknown}")))
})
test("augmentation type and documentation mutations remain blocking", () => {
  unequal(compare(corpus.before, corpus.after.replace("comparisonProbe?: string", "comparisonProbe?: number")))
  const a = corpus.before.replace("readonly comparisonProbe", "\n/** Original annotation. */\nreadonly comparisonProbe")
  const b = corpus.after.replace("readonly comparisonProbe", "\n/** Changed annotation. */\nreadonly comparisonProbe")
  unequal(compare(a, b))
})

test("property: ambient closures admit only directional generated never documentation", async () => {
  await checkProperty(fc, {
    name: "api-identity-ambient-generated-docs", generatorVersion: 1,
    rule: quote,
    command: "node --test scripts/api-identity-ambient-generated-docs.test.mjs",
    arbitrary: fc.record({ name: fc.constantFrom("helper", "convert", "parseValue"), callable: fc.boolean(),
      lazy: fc.boolean(), documented: fc.boolean() }),
    numRuns: 16,
    check: ({ name, callable, lazy, documented }) => {
      let before = corpus.before.replaceAll("helper", name), after = corpus.after.replaceAll("helper", name)
      if (callable) {
        before = before.replace(`function ${name}(value: number): number`, `const ${name}: (value: number) => number`)
        after = after.replace(`function ${name}(value: number): number`, `const ${name}: (value: number) => number`)
      }
      if (documented) {
        before = before.replace("export declare", "/** Public helper. */\nexport declare")
        after = after.replace("@throws {never}", "Public helper.\n * @throws {never}")
      }
      identical(compare(before, after, lazy))
      unequal(compare(after, before, lazy))
      unequal(compare(before, after.replace("@throws {never}", "@throws {Error}"), lazy))
      unequal(compare(before, after.replace("comparisonProbe?: string", "comparisonProbe?: number"), lazy))
    },
  })
})
