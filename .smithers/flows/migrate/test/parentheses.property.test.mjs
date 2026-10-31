import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { canonicalize } from "../lib/declarations.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const quote = "Declarations are exactly what idiomatic Effect TypeScript would declare."

const type = fc.constantFrom("string", "number", "string | number", "readonly [number, string]",
  "<A>(value: A) => A", "() => string", "{ readonly value: number }")
const position = fc.constantFrom(
  (t) => "export type Item = " + t + ";",
  (t) => "export declare const make: () => " + t + ";",
  (t) => "export interface Item { readonly value: " + t + " }"
)

test("foldkit-13: redundant type parentheses preserve the declared TypeScript type", () => {
  assert.ok(readFileSync(SpecPath("001-functions.md"), "utf8").includes(quote), "update the quoted declaration contract")
  const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-returned-function-parentheses.json", import.meta.url), "utf8"))
  assert.equal(canonicalize(ts, corpus.before), canonicalize(ts, corpus.after), corpus.key)
  fc.assert(fc.property(type, position, fc.integer({ min: 1, max: 4 }), (typ, wrap, depth) => {
    const parens = "(".repeat(depth) + typ + ")".repeat(depth)
    assert.equal(canonicalize(ts, wrap(typ)), canonicalize(ts, wrap(parens)))
  }), { seed: 13133, numRuns: 250 })
})

test("type normalization keeps parentheses that determine union, array and function precedence", () => {
  for (const [before, after] of [
    ["(string | number)[]", "string | number[]"],
    ["(() => string) | number", "() => string | number"],
    ["(() => number)[]", "() => number[]"],
    ["readonly [number, string]", "[number, string]"]
  ]) {
    assert.notEqual(canonicalize(ts, "export type Item = " + before + ";"),
      canonicalize(ts, "export type Item = " + after + ";"))
  }
})
