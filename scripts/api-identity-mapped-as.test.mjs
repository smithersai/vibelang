// tsc compares a mapped type's `as` clause by reference, so a generic alias
// whose mapped type has one fails strict identity whenever its file is not
// proved equal, unchanged or not. The comparison proves such an alias from a
// form that states the mapped type as a signature over its key.
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { createEs5FixtureGuard } from "./testing/fixture-libraries.mjs"

const es5 = createEs5FixtureGuard(loadTypeScript(), "Mapped as-clause fixtures")
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const prefix = "export interface Box<T> { value: T }\n"
const alias = "export type Strings<A> = { [K in keyof A as K extends string ? K : never]: A[K] };\n"
// A line that keeps the two files from being proved equal.
const unrelated = value => `declare const hidden: ${value};\nexport { hidden };\n`

function compare(before, after) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-mapped-as-"))
  try {
    for (const [side, text] of [["before", before], ["after", after]]) {
      mkdirSync(join(root, side))
      writeFileSync(join(root, side, "index.d.ts"), text)
    }
    const entries = { "index.d.ts": "index.d.ts" }
    const result = compareApiIdentity(es5.ts, join(root, "before"), join(root, "after"),
      { beforeEntrypoints: entries, afterEntrypoints: entries, compilerOptions: { lib: ["lib.es5.d.ts"] } })
    es5.assertLibraries()
    return result
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const differing = result => [...new Set(result.typeDifferences.map(d => d.export))].sort()
const pair = (a, b = a) => compare(prefix + a + unrelated(1), prefix + b + unrelated(2))

test("an unchanged as-clause alias is identical", () => {
  const result = pair(alias)
  assert.deepEqual(differing(result), ["hidden"], JSON.stringify(result.typeDifferences))
  assert.deepEqual(result.environmentDiagnostics.filter(d => d.blocking), [])
})

test("a generic export over an unchanged as-clause alias is identical", () => {
  assert.deepEqual(differing(pair(alias + "export declare function strings<A>(value: A): Strings<A>;\n")), ["hidden"])
})

test("an as clause inside an infer alias, and a recursive one, is identical", () => {
  const text = "export type Deep<A> = A extends Box<infer V> ? { readonly [K in keyof V as K extends string ? K : never]-?: Deep<V[K]> } : A;\n"
  assert.deepEqual(differing(pair(text)), ["hidden"])
})

test("Smithers' Node.Succeed, unchanged beside a moved declaration, is identical", () => {
  const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/smithers-plan-node-succeed.json", import.meta.url), "utf8"))
  const result = pair(corpus.source)
  assert.deepEqual(differing(result), ["hidden"], JSON.stringify(result.typeDifferences))
  assert.ok(differing(pair(corpus.source, corpus.source.replace("A extends bigint ? never", "A extends bigint ? string"))).includes("Succeed"))
})

const changes = [
  ["the as type", alias.replace("K extends string ? K : never", "K extends number ? K : never")],
  ["the template", alias.replace(": A[K] }", ": A[K][] }")],
  ["the constraint", "export type Strings<A> = { [K in keyof A | \"extra\" as K extends string ? K : never]: K extends keyof A ? A[K] : never };\n"],
  ["readonly", alias.replace("{ [K", "{ readonly [K")],
  ["optional", alias.replace("]: A[K]", "]?: A[K]")],
  ["removed optional", alias.replace("]: A[K]", "]-?: A[K]")],
  ["no as clause", "export type Strings<A> = { [K in keyof A]: A[K] };\n"],
]
for (const [name, changed] of changes) test("a change to " + name + " is a type difference", () => {
  assert.ok(differing(pair(alias, changed)).includes("Strings"), name)
})

// Every pair of specs from these parts compares identical exactly when the
// specs are equal: each part changes what the mapped type means.
test("property: an as-clause alias is identical exactly when its parts are equal", () => {
  const parts = fc.record({
    readonly: fc.constantFrom("", "readonly ", "-readonly "),
    optional: fc.constantFrom("", "?", "-?"),
    as: fc.constantFrom("K extends string ? K : never", "K extends string ? `get_${K}` : never", "Exclude<K, \"skip\">"),
    template: fc.constantFrom("A[K]", "A[K][]", "Box<A[K]>"),
  })
  const write = p => `export type Mapped<A> = { ${p.readonly}[K in keyof A as ${p.as}]${p.optional}: ${p.template} };\n`
  fc.assert(fc.property(parts, parts, (a, b) => {
    const same = write(a) === write(b)
    const result = pair(write(a), write(b))
    assert.equal(differing(result).includes("Mapped"), !same, write(a) + write(b))
    assert.deepEqual(result.environmentDiagnostics.filter(d => d.blocking), [])
  }), { numRuns: 24, seed: 7 })
})
