// tsc reads `ReadonlyArray<T>` and `readonly T[]` as one type, and `Array<T>`
// and `T[]` as another. A declaration file that changes only that spelling
// therefore keeps its module-closure proof, and a deferred `infer` export
// beside it stays identical. A real element or mutability change, and a local
// declaration that shadows the standard-library name, still differ.
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { createEs5FixtureGuard } from "./testing/fixture-libraries.mjs"
import { checkProperty } from "./testing/property.mjs"

const es5 = createEs5FixtureGuard(loadTypeScript(), "Array-spelling fixtures")
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/t3code-deferred-readonly-array-spelling.json", import.meta.url), "utf8"))
const prefix = "export interface Box { value: string }\n"

function compare(before, after) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-array-"))
  try {
    for (const [side, text] of [["before", before], ["after", after]]) {
      mkdirSync(join(root, side))
      writeFileSync(join(root, side, "index.d.ts"), text)
    }
    const entries = { "index.d.ts": "index.d.ts" }
    const result = compareApiIdentity(es5.ts, join(root, "before"), join(root, "after"),
      { beforeEntrypoints: entries, afterEntrypoints: entries, compilerOptions: { lib: ["lib.es5.d.ts"], strict: true } })
    es5.assertLibraries()
    return result
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const differing = result => [...new Set(result.typeDifferences.map(d => d.export))].sort()
const blocking = result => result.environmentDiagnostics.filter(d => d.blocking)
function identical(before, after, label) {
  const result = compare(before, after)
  assert.equal(result.comparisonComplete, true, label + ": " + JSON.stringify(result))
  assert.deepEqual(blocking(result), [], label)
  assert.deepEqual(differing(result), [], label + ": " + JSON.stringify(result.typeDifferences))
  assert.equal(result.identical, true, label)
}
// Run every cell of a matrix and report each failing one, so a partial fix
// shows how much of the neighbourhood it covers.
function matrix(cells) {
  const failures = []
  for (const [label, check] of cells) {
    try { check() } catch (error) { failures.push(label) }
  }
  assert.deepEqual(failures, [], failures.length + " of " + cells.length + " cells fail")
}
function differs(before, after, name, label) {
  const result = compare(before, after)
  assert.equal(result.identical, false, label)
  assert.ok(differing(result).includes(name), label + ": " + JSON.stringify(result.typeDifferences))
}

// Exports whose deferred infer or mapped parameters tsc compares only through
// the module-closure proof.
const carriers = {
  "const arrow": "export declare const f: <C>(c: C) => C extends (infer I)[] ? I : never;\n",
  "function": "export declare function g<C>(c: C): C extends readonly (infer I)[] ? I : never;\n",
  "mapped": "export declare const m: <T>(t: T) => { readonly [K in keyof T]: T[K] };\n",
  "method": "export interface Reader { read<C>(c: C): C extends (infer I)[] ? I : never }\n",
}
// Each pair names one type to tsc.
const spellings = [
  ["ReadonlyArray<string>", "readonly string[]"],
  ["Array<string>", "string[]"],
  ["ReadonlyArray<string | number>", "readonly (string | number)[]"],
  ["Array<ReadonlyArray<number>>", "(readonly number[])[]"],
  ["ReadonlyArray<Array<Box>>", "readonly Box[][]"],
  ["ReadonlyArray<() => void>", "readonly (() => void)[]"],
]
const positions = {
  "sibling alias": type => "export type Used = " + type + ";\n",
  "interface member": type => "export interface Holder { items: " + type + " }\n",
  "parameter": type => "export declare const take: <C>(c: C, items: " + type + ") => C extends (infer I)[] ? I : never;\n",
}

test("the t3code witness: an unchanged deferred infer export survives a ReadonlyArray respelling", () => {
  identical(corpus.before, corpus.after, "corpus")
  identical(corpus.after, corpus.before, "corpus reversed")
})

test("every deferred carrier survives every standard-library array respelling beside it", () => {
  matrix(Object.entries(carriers).flatMap(([carrier, text]) => spellings.map(([a, b]) => [carrier + ": " + a + " / " + b,
    () => identical(prefix + text + positions["sibling alias"](a), prefix + text + positions["sibling alias"](b), carrier)])))
})

test("respellings in a member or in the deferred signature itself, in both directions", () => {
  matrix(Object.entries(positions).flatMap(([position, place]) => spellings.flatMap(([a, b]) => {
    const before = prefix + carriers["const arrow"] + place(a), after = prefix + carriers["const arrow"] + place(b)
    return [[position + ": " + a + " / " + b, () => identical(before, after, position)],
      [position + " reversed: " + b + " / " + a, () => identical(after, before, position)]]
  })))
})

test("real changes and shadowed names still differ", () => {
  const witness = carriers["const arrow"]
  for (const [a, b, label] of [
    ["ReadonlyArray<string>", "readonly number[]", "element"],
    ["ReadonlyArray<string>", "string[]", "readonly removed"],
    ["Array<string>", "readonly string[]", "readonly added"],
    ["ReadonlyArray<Array<number>>", "readonly (readonly number[])[]", "nested readonly added"],
  ]) differs(prefix + witness + positions["sibling alias"](a), prefix + witness + positions["sibling alias"](b), "Used", label)
  for (const local of [
    "interface ReadonlyArray<T> { brand: T }\n",
    "type ReadonlyArray<T> = { brand: T };\n",
  ]) differs(prefix + local + witness + "export type Used = ReadonlyArray<string>;\n",
    prefix + local + witness + "export type Used = readonly string[];\n", "Used", "shadowed by " + local.trim())
  differs(prefix + "interface Array<T> { brand: T }\n" + witness + "export type Used = Array<string>;\n",
    prefix + "interface Array<T> { brand: T }\n" + witness + "export type Used = string[];\n", "Used", "shadowed Array")
  differs(corpus.before, corpus.before.replace("(infer I)[] ? I", "(infer I)[] ? I[]"), "f", "carrier branch changed")
})

// A random array type tree, printed with a random spelling at each array.
const leaf = fc.constantFrom("string", "number", "boolean", "Box")
const { node } = fc.letrec(tie => ({
  node: fc.oneof({ depthSize: "small" }, leaf, tie("array"), tie("union")),
  array: fc.record({ readonly: fc.boolean(), element: tie("node") }),
  union: fc.tuple(tie("node"), tie("node")),
}))
const top = fc.record({ readonly: fc.boolean(), element: node })
function print(tree, bits) {
  let index = 0
  const bit = () => bits[index++ % bits.length]
  const visit = t => {
    if (typeof t === "string") return { text: t, compound: false }
    if (Array.isArray(t)) return { text: t.map(member => visit(member).text).join(" | "), compound: true }
    const element = visit(t.element)
    if (bit()) return { text: (t.readonly ? "ReadonlyArray<" : "Array<") + element.text + ">", compound: false }
    const operand = element.compound ? "(" + element.text + ")" : element.text
    return { text: (t.readonly ? "readonly " : "") + operand + "[]", compound: t.readonly }
  }
  return visit(tree).text
}

test("property: any respelling of an array tree is identical; flipping its readonly is not", async () => {
  await checkProperty(fc, {
    name: "api-identity-array-spelling",
    rule: corpus.rule + " Changing whether the outer array is readonly still differs.",
    command: "node --test scripts/api-identity-array-spelling.test.mjs",
    arbitrary: fc.record({
      tree: top,
      carrier: fc.constantFrom(...Object.keys(carriers)),
      left: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
      right: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
    }),
    numRuns: 16,
    check: ({ tree, carrier, left, right }) => {
      const file = type => prefix + carriers[carrier] + "export type Used = " + type + ";\n"
      identical(file(print(tree, left)), file(print(tree, right)), print(tree, left) + " / " + print(tree, right))
      const flipped = { ...tree, readonly: !tree.readonly }
      differs(file(print(tree, left)), file(print(flipped, right)), "Used", print(tree, left) + " / " + print(flipped, right))
    },
  })
})
