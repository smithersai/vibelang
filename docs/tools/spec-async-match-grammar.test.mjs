import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"

test("match bodies and the independent async context have explicit grammar roots", () => {
  const appendix = chapter("900-appendices")
  assert.ok(appendix.includes('MatchExpression = "match" [no LineTerminator here] "(" Expression ")" [no LineTerminator here] MatchBody'))
  assert.ok(appendix.includes('AsyncMatchExpression = "async" [no LineTerminator here] MatchExpression[~Yield, +Await, ~Effect]'))
  assert.ok(appendix.includes("nested functions retain their own ordinary contexts"))
  for (const name of ["MatchExpression", "AsyncMatchExpression"]) assert.equal((appendix.match(new RegExp("^" + name + " =", "gm")) || []).length, 1)
  const result = run(block(chapter("004-match"), "const grammarAsyncExit") + `
import assert from "node:assert/strict"
assert.equal(grammarAsyncExit._tag, "Success")
assert.equal(grammarAsyncExit.value, 9)
`)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
