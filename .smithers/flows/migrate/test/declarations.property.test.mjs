import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { canonicalize } from "../lib/declarations.mjs"

// The migration tests already use packages/runtime's installed TypeScript API.
// Its declared fast-check development dependency supplies this property runner.
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")

const quote = "Only proven private declarations use canonical comparison."
const rules = new URL("../rules.md", import.meta.url)

const forms = [
  (p) => `export * from ${JSON.stringify(p)};`,
  (p) => `export { type Item } from ${JSON.stringify(p)};`,
  (p) => `import * as Module from ${JSON.stringify(p)}; export type Item = Module.Item;`,
  (p) => `import type { Item } from ${JSON.stringify(p)}; export { type Item };`,
  (p) => `import Module = require(${JSON.stringify(p)}); export type Item = Module.Item;`,
  (p) => `export declare const value: import(${JSON.stringify(p)}).Item;`,
  (p) => `declare module ${JSON.stringify(p)} { interface Item { readonly value: number } }`
]
const segment = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,12}$/)
const modulePath = fc.tuple(
  fc.constantFrom("./", "../", "../../", "../../../"),
  fc.array(fc.oneof(segment, fc.constantFrom("with space", "café", "under.score", "x.ts-folder")), { minLength: 1, maxLength: 4 })
).map(([prefix, parts]) => prefix + parts.join("/"))

test("private canonical comparison groups relative source extensions without granting public equality", () => {
  assert.ok(readFileSync(rules, "utf8").includes(quote), "update the quoted migration rule")
  const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-relative-module.json", import.meta.url), "utf8"))
  assert.equal(canonicalize(ts, corpus.before), canonicalize(ts, corpus.after), corpus.key)
  fc.assert(fc.property(modulePath, fc.integer({ min: 0, max: forms.length - 1 }), (path, form) => {
    assert.equal(canonicalize(ts, forms[form](path + ".ts")), canonicalize(ts, forms[form](path + ".js")))
  }), { seed: 298365, numRuns: 350 })
})

test("relative module normalization preserves strings, package names and declaration-file extensions", () => {
  fc.assert(fc.property(modulePath, fc.integer({ min: 0, max: forms.length - 1 }), (path, form) => {
    for (const prefix of ["export type Path = ", "export declare const path: "]) {
      assert.notEqual(canonicalize(ts, prefix + JSON.stringify(path + ".ts") + ";"),
        canonicalize(ts, prefix + JSON.stringify(path + ".js") + ";"))
    }
    const bare = path.replace(/^(?:\.\.?\/)+/, "")
    assert.notEqual(canonicalize(ts, forms[form](bare + ".ts")), canonicalize(ts, forms[form](bare + ".js")))
    assert.notEqual(canonicalize(ts, forms[form](path + ".d.ts")), canonicalize(ts, forms[form](path + ".d.js")))
  }), { seed: 298366, numRuns: 350 })
})

// foldkit-16: html/lazy's TypeScript wraps a TaggedEnum payload in
// Readonly<{ … }>; its .vibe data declaration writes the fields readonly.
test("foldkit-16: Readonly<{ … }> is the type literal with every member readonly", () => {
  fc.assert(fc.property(
    fc.uniqueArray(fc.record({ name: fc.constantFrom("a", "b", "count", "previousCount"), optional: fc.boolean(), written: fc.boolean(), type: fc.constantFrom("number", "string", "A", "ReadonlyArray<B>") }), { selector: (m) => m.name, minLength: 1, maxLength: 4 }),
    fc.constantFrom((t) => `export type Item = ${t};`, (t) => `export type E = Data.TaggedEnum<{ V: ${t} }>;`, (t) => `export declare const make: (x: ${t}) => void;`),
    fc.boolean(),
    (members, wrap, index) => {
      const field = (m, readonly) => `${readonly ? "readonly " : ""}${m.name}${m.optional ? "?" : ""}: ${m.type}`
      const fields = members.map((m) => field(m, m.written))
      if (index) fields.push(`${members.some((m) => m.written) ? "readonly " : ""}[key: string]: unknown`)
      const wrapped = `Readonly<{ ${fields.join("; ")} }>`
      const all = members.map((m) => field(m, true))
      if (index) all.push("readonly [key: string]: unknown")
      assert.equal(canonicalize(ts, wrap(wrapped)), canonicalize(ts, wrap(`{ ${all.join("; ")} }`)))
      // A member Readonly does not cover stays writable on the other side.
      if (!members[0].written) assert.notEqual(canonicalize(ts, wrap(`{ ${fields.join("; ")} }`)), canonicalize(ts, wrap(`{ ${all.join("; ")} }`)))
    }
  ), { seed: 16016, numRuns: 300 })
  const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-data-readonly-payload.json", import.meta.url), "utf8"))
  assert.equal(canonicalize(ts, corpus.typescript), canonicalize(ts, corpus.vibelang), corpus.finding)
  // A method makes no readonly member, so Readonly<{ m(): void }> keeps its spelling.
  assert.notEqual(canonicalize(ts, "export type T = Readonly<{ m(): void }>;"), canonicalize(ts, "export type T = { m(): void };"))
})
