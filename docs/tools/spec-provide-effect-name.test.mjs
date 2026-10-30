import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"
test("a local effect provider needs parentheses under the contextual expression grammar", () => {
  const source=chapter("005-services")
  for (const text of ["Write `provide (effect) { … }`", "leaving no provide body",
    "cold Effect is neither a Layer nor a Context", "does not inspect the local binding's type"])
    assert.ok(source.includes(text),text)
  const grammar=chapter("900-appendices")
  assert.match(grammar, /EffectBlock = [^\n]+FunctionBody\[~Yield, ~Await, \+Effect\]/)
  assert.match(grammar,/Provider = .*AssignmentExpression/)
  const result=run(block(source,"function providerName()")+
    "\nif (!Exit.isSuccess(providerNameExit) || providerNameExit.value !== 1) throw new Error('wrong provider')\n")
  assert.equal(result.status,0,result.stdout+result.stderr)
})
