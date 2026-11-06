// Two `infer` declarations are never identical to tsc, so a generic alias using
// one fails strict identity whenever its file is not proved equal, unchanged or
// not. The comparison proves such an alias from a form without `infer`.
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { createEs5FixtureGuard } from "./testing/fixture-libraries.mjs"

const es5 = createEs5FixtureGuard(loadTypeScript(), "Pure infer-alias fixtures")
const prefix = "export interface Box<T> { value: T }\nexport interface Bag<T> { item: T }\n"
const alias = "export type Inner<R> = R extends Box<infer A> ? A : never;\n"
// A line that keeps the two files from being proved equal.
const unrelated = value => `declare const hidden: ${value};\nexport { hidden };\n`

function compare(before, after) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-infer-"))
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

test("an unchanged infer alias is identical", () => {
  const result = pair(alias)
  assert.deepEqual(differing(result), ["hidden"], JSON.stringify(result.typeDifferences))
  assert.deepEqual(result.environmentDiagnostics.filter(d => d.blocking), [])
})

test("a generic export over an unchanged infer alias is identical", () => {
  const consumer = alias + "export declare function read<T>(value: T): Inner<T>;\n"
  assert.deepEqual(differing(pair(consumer)), ["hidden"])
})

test("an instantiated infer alias keeps its result", () => {
  const consumer = alias + 'export type One = Inner<Box<"one">>;\n'
  assert.deepEqual(differing(pair(consumer)), ["hidden"])
  assert.deepEqual(differing(pair(consumer, consumer.replace('"one">', '"two">'))), ["One", "hidden"])
})

test("nested conditionals, repeated infer names and constraints are identical", () => {
  const text = "export type Deep<R, S> = R extends Box<infer A extends string> ? (S extends Box<infer A> | Bag<infer A> ? [A] : A) : never;\n"
  assert.deepEqual(differing(pair(text)), ["hidden"])
})

test("an infer position with a constraint of its own is identical", () => {
  const text = "export interface Keyed<K extends string> { key: K }\nexport type Key<R> = R extends Keyed<infer K> ? K : never;\n"
  const result = pair(text)
  assert.deepEqual(differing(result), ["hidden"], JSON.stringify(result.typeDifferences))
  assert.deepEqual(result.environmentDiagnostics.filter(d => d.blocking), [])
})

test("a recursive infer alias is identical, and a snapshot compared with itself stays comparable", () => {
  const text = "export type Last<R> = R extends Box<infer A> ? Last<A> : R;\n"
  assert.deepEqual(differing(pair(text)), ["hidden"])
  const result = compare(prefix + text, prefix + text)
  assert.deepEqual(result.environmentDiagnostics.filter(d => d.blocking), [])
  assert.equal(result.identical, true)
})

const changes = [
  ["the true branch", alias.replace("? A :", "? A[] :")],
  ["the false branch", alias.replace("never", "string")],
  ["the false branch to any", alias.replace("never", "any")],
  ["the true branch to any", alias.replace("? A :", "? any :")],
  ["the extends type", alias.replace("Box<infer A>", "Bag<infer A>")],
  ["the infer position", "export type Inner<R> = R extends Box<Box<infer A>> ? A : never;\n"],
  ["the infer constraint", alias.replace("infer A", "infer A extends string")],
  ["the check type", "export type Inner<R> = [R] extends [Box<infer A>] ? A : never;\n"],
  ["the type parameter", alias.replace("<R>", "<R extends object>")],
]
for (const [name, changed] of changes) test("a change to " + name + " is a type difference", () => {
  assert.ok(differing(pair(alias, changed)).includes("Inner"), name)
})

test("a change in a private infer alias reaches the export that uses it", () => {
  const text = "type Hidden<R> = R extends Box<infer A> ? A : never;\nexport type Public<R> = Hidden<R>;\nexport {};\n"
  const result = pair(text, text.replace("? A :", "? A[] :"))
  assert.ok(differing(result).length > 1, JSON.stringify(result.typeDifferences))
})
