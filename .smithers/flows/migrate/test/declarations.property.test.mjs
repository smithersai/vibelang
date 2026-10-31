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

const quote = "the identity gate treats a relative `./leaf.ts` and `./leaf.js` as one module."
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

test("alchemy-2 and t3code: relative source extensions denote one declaration module", () => {
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
