import assert from "node:assert/strict"
import test from "node:test"
import { chapter } from "./spec-witness.mjs"

test("block recovery reuses the full Effect modifier grammar without admitting an async-only block", () => {
  const appendix = chapter("900-appendices")
  const block = appendix.match(/^EffectBlock = (.+)$/m)?.[1]
  assert.match(block, /^EffectModifier \[no LineTerminator here\] "\{"/)
  const grammar = appendix.split("EffectModifier = ")[1].split("```")[0]
  const heads = grammar.split(/\n\s*\|\s*/).map(arm => [...arm.matchAll(/"(effect|async)"/g)].map(m => m[1]).join(" "))
  assert.deepEqual(heads, ["effect", "effect async", "async effect"])
  assert.match(appendix, /arrow parameters or an expression-position block/)
})

test("both mixed block heads receive EK0105 and the repair keeps the Effect block", () => {
  const functions = chapter("001-functions")
  const appendix = chapter("900-appendices")
  for (const text of [functions, appendix]) {
    assert.match(text, /`effect` and `async` on one function or block/)
  }
  assert.match(functions, /effect async \{ return 7 \}.*EK0105/)
  assert.match(functions, /async effect \{ return 7 \}.*EK0105/)
  assert.match(appendix, /remove `async`.*`effect \{ B \}`/)
  assert.match(appendix, /`async \{ B \}` is not admitted/)
})
