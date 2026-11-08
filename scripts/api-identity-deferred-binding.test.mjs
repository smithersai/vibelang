// tsc never calls two `infer` declarations identical, so an exported binding
// whose declared type uses `infer` (or a mapped `as` clause) was proved only
// when its whole file was. Any other change in that file, such as moving a
// function behind a re-export, then reported the unchanged binding. Each side
// now states the binding's declared type without `infer`, and the strict probe
// of those forms decides; a real change to the binding still differs.
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { createEs5FixtureGuard } from "./testing/fixture-libraries.mjs"
import { checkProperty } from "./testing/property.mjs"

const es5 = createEs5FixtureGuard(loadTypeScript(), "Deferred binding fixtures")
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/t3code-deferred-value-reexport.json", import.meta.url), "utf8"))

function compare(before, after) {
  const root = mkdtempSync(join(tmpdir(), "api-deferred-binding-"))
  try {
    for (const [side, files] of [["before", before], ["after", after]]) {
      mkdirSync(join(root, side))
      for (const [name, text] of Object.entries(files)) writeFileSync(join(root, side, name), text)
    }
    const entries = { index: "index.d.ts" }
    const result = compareApiIdentity(es5.ts, join(root, "before"), join(root, "after"),
      { beforeEntrypoints: entries, afterEntrypoints: entries, compilerOptions: { lib: ["lib.es5.d.ts"], strict: true } })
    es5.assertLibraries()
    return result
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const verdict = result => JSON.stringify({ identical: result.identical, complete: result.comparisonComplete,
  types: result.typeDifferences.map(d => [d.export, d.aspect, d.mutuallyAssignable]), names: result.nameDifferences,
  docs: result.docDifferences, environment: result.environmentDiagnostics.filter(d => d.blocking) })
const reported = result => new Set(result.typeDifferences.map(d => d.export))
function matrix(cells) {
  const failures = []
  for (const [label, check] of cells) {
    try { check() } catch { failures.push(label) }
  }
  assert.deepEqual(failures, [], failures.length + " of " + cells.length + " cells fail: " + failures.slice(0, 6).join("; "))
}

// Exported bindings whose declared type uses `infer` or a mapped `as` clause.
const carriers = {
  "const arrow": "export declare const f: <C>(c: C) => C extends (infer I)[] ? I : never;\n",
  "nested infer": "export declare const f: <C>(c: C) => C extends { value: infer V } ? (V extends (infer I)[] ? I : V) : never;\n",
  "constrained infer": "export declare const f: <C>(c: C) => C extends (infer I extends string)[] ? I : never;\n",
  "mapped as": "export declare const f: <T>(t: T) => { [K in keyof T as Exclude<K, \"hidden\">]: T[K] };\n",
  "method object": "export declare const f: { read<C>(c: C): C extends (infer I)[] ? I : never };\n",
  "let": "export declare let f: <C>(c: C) => C extends (infer I)[] ? I : never;\n",
  "export clause": "declare const f: <C>(c: C) => C extends (infer I)[] ? I : never;\nexport { f };\n",
}
// Changes elsewhere in the file. `changed` names the export that really changes.
const siblings = {
  "relocated function": {
    before: { index: "export declare function g(x: number): number;\n" },
    after: { index: "export { g } from \"./helper.js\";\n", "helper.d.ts": "export declare function g(x: number): number;\n" },
  },
  "changed function": {
    before: { index: "export declare function g(x: number): number;\n" },
    after: { index: "export declare function g(x: number): string;\n" },
    changed: "g",
  },
  "renamed type export": {
    before: { index: "export type Id = string;\n" },
    after: { index: "type Local = string;\nexport type { Local as Id };\n" },
  },
  "reordered declarations": {
    before: { index: "export interface Box { a: string; b: number }\nexport declare const n: number;\n" },
    after: { index: "export declare const n: number;\nexport interface Box { b: number; a: string }\n" },
  },
}
function files(carrier, part) {
  const out = { "index.d.ts": carrier + part.index }
  for (const [name, text] of Object.entries(part)) if (name !== "index") out[name] = text
  return out
}
// Real changes to the binding's own type.
const mutations = [
  ["result", text => text.replace("? I :", "? number :")],
  ["infer position", text => text.replace("(infer I)[]", "readonly (infer I)[]")],
  ["infer constraint", text => text.replace("(infer I)[]", "(infer I extends number)[]")],
]
const mutable = Object.entries(carriers).filter(([, text]) => text.includes("(infer I)[]") && text.includes("? I :"))

test("the t3code witness: an unchanged deferred const survives a sibling moving behind a re-export", () => {
  const result = compare(corpus.before, corpus.after)
  assert.equal(result.comparisonComplete, true, verdict(result))
  assert.equal(result.identical, true, verdict(result))
})

test("no unchanged deferred binding is reported for any change elsewhere in its file", () => {
  matrix(Object.entries(carriers).flatMap(([carrier, text]) => Object.entries(siblings).map(([sibling, change]) => [carrier + " / " + sibling, () => {
    const result = compare(files(text, change.before), files(text, change.after))
    assert.equal(result.comparisonComplete, true, verdict(result))
    assert.equal(reported(result).has("f"), false, verdict(result))
    assert.deepEqual([...reported(result)], change.changed ? [change.changed] : [], verdict(result))
  }])))
})

test("a real change to the binding's own type still differs, beside or without other changes", () => {
  matrix(mutable.flatMap(([carrier, text]) => mutations.flatMap(([label, mutate]) =>
    [["none", { before: { index: "" }, after: { index: "" } }], ...Object.entries(siblings).slice(0, 2)].map(([sibling, change]) =>
      [carrier + " / " + label + " / " + sibling, () => {
        const after = mutate(text)
        assert.notEqual(after, text)
        const result = compare(files(text, change.before), files(after, change.after))
        assert.equal(result.identical, false, verdict(result))
        assert.ok(reported(result).has("f"), verdict(result))
      }]))))
  const mapped = carriers["mapped as"]
  const result = compare(files(mapped, siblings["relocated function"].before), files(mapped.replace("\"hidden\"", "\"secret\""), siblings["relocated function"].after))
  assert.ok(reported(result).has("f"), verdict(result))
  const swapped = "export declare const f: <C, D>(c: C, d: D) => C extends (infer I)[] ? I : never;\n"
  const order = compare(files(swapped, siblings["relocated function"].before), files(swapped.replace("<C, D>(c: C, d: D)", "<D, C>(c: C, d: D)"), siblings["relocated function"].after))
  assert.ok(reported(order).has("f"), verdict(order))
})

test("property: a deferred binding is reported exactly when its own type changes", async () => {
  await checkProperty(fc, {
    name: "api-identity-deferred-binding",
    rule: corpus.rule + " A real change to the binding's own type still differs.",
    command: "node --test scripts/api-identity-deferred-binding.test.mjs",
    arbitrary: fc.record({
      carrier: fc.constantFrom(...mutable.map(([name]) => name)),
      sibling: fc.constantFrom(...Object.keys(siblings)),
      mutation: fc.option(fc.integer({ min: 0, max: mutations.length - 1 }), { nil: undefined }),
    }),
    numRuns: 16,
    check: ({ carrier, sibling, mutation }) => {
      const text = carriers[carrier], change = siblings[sibling]
      const after = mutation === undefined ? text : mutations[mutation][1](text)
      const result = compare(files(text, change.before), files(after, change.after))
      assert.equal(result.comparisonComplete, true, verdict(result))
      assert.equal(reported(result).has("f"), mutation !== undefined, verdict(result))
    },
  })
})
