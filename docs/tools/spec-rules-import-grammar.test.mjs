import { test } from "node:test"
import assert from "node:assert/strict"
import ts from "typescript"
import fc from "fast-check"
import { lintImportGrammar, readImportGrammar, sideEffectImportDerivations } from "./spec-rules-import-grammar.mjs"

const native = "an ordinary TypeScript import declaration using ModuleSpecifier"
const extra = '"import" ModuleSpecifier ";"'
const fence = String.fromCharCode(96).repeat(3)
const grammar = alternatives => "#### ImportDeclaration\n\n" + fence + "text\nImportDeclaration = " + alternatives.join("\n                  | ") + "\n" + fence + "\n"
const old = grammar([native, extra])

test("the real spec has one side-effect import derivation", () => {
  assert.deepEqual(lintImportGrammar(readImportGrammar(process.env.SPEC_ROOT)), [])
})
test("round 25 defect has two derivations; either standalone production has one", () => {
  assert.equal(sideEffectImportDerivations(old).length, 2)
  assert.equal(lintImportGrammar(old).length, 1)
  for (const alternative of [native, extra]) {
    assert.equal(sideEffectImportDerivations(grammar([alternative])).length, 1)
    assert.deepEqual(lintImportGrammar(grammar([alternative])), [])
  }
})
test("stock TypeScript parses a side-effect import as an ordinary ImportDeclaration", () => {
  fc.assert(fc.property(fc.stringMatching(/^[a-z][a-z0-9]{0,18}$/), name => {
    const source = 'import "./' + name + '.js";'
    const file = ts.createSourceFile("twin.ts", source, ts.ScriptTarget.Latest, true)
    assert.equal(file.parseDiagnostics.length, 0)
    assert.equal(file.statements.length, 1)
    assert.ok(ts.isImportDeclaration(file.statements[0]))
    assert.equal(file.statements[0].importClause, undefined)
    assert.equal(file.statements[0].moduleSpecifier.text, "./" + name + ".js")
    // VIP-40 substitutes the identifier for the native string specifier;
    // both alternatives still derive the same side-effect form.
    assert.equal(sideEffectImportDerivations(old).length, 2)
  }), { seed: 25001, numRuns: 200 })
})
test("formatting and alternative order do not conceal the duplicate", () => {
  for (const alternatives of [[native, extra], [extra, native]]) {
    for (const spacing of [" ", "  ", "\t"]) {
      assert.equal(lintImportGrammar(grammar(alternatives).replaceAll(" ", spacing)).length, 1)
    }
  }
  assert.deepEqual(lintImportGrammar(grammar([native, '"import" "=" AssignmentExpression ";"'])), [])
})
