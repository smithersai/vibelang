import { test } from "node:test"
import assert from "node:assert/strict"
import { lintImportGrammar, readImportGrammar, sideEffectImportDerivations } from "./spec-rules-import-grammar.mjs"

const native = "an ordinary TypeScript import declaration using ModuleSpecifier"
const extra = '"import" ModuleSpecifier ";"'
const fence = String.fromCharCode(96).repeat(3)
const grammar = alternatives => "#### ImportDeclaration\n\n" + fence + "text\nImportDeclaration = " + alternatives.join("\n                  | ") + "\n" + fence + "\n"
const old = grammar([native, extra])

test("the real spec has one side-effect import derivation", () => {
  assert.deepEqual(lintImportGrammar(readImportGrammar(process.env.SPEC_ROOT)), [])
})
test("duplicating the side-effect import production gives it two derivations", () => {
  assert.equal(sideEffectImportDerivations(old).length, 2)
  assert.equal(lintImportGrammar(old).length, 1)
  for (const alternative of [native, extra]) {
    assert.equal(sideEffectImportDerivations(grammar([alternative])).length, 1)
    assert.deepEqual(lintImportGrammar(grammar([alternative])), [])
  }
})
test("formatting and alternative order do not conceal the duplicate", () => {
  for (const alternatives of [[native, extra], [extra, native]]) {
    for (const spacing of [" ", "  ", "\t"]) {
      assert.equal(lintImportGrammar(grammar(alternatives).replaceAll(" ", spacing)).length, 1)
    }
  }
  assert.deepEqual(lintImportGrammar(grammar([native, '"import" "=" AssignmentExpression ";"'])), [])
})
