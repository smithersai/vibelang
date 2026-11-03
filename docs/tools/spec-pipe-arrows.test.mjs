import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { violations } from "./spec-pipe-arrows.mjs"

const old = "It is a Syntax Error if the `ShortCircuitExpression` of a `PipeExpression` is a `CatchExpression` whose handler is an `ArrowHandler`; the `|>` then belongs to the arrow's body."
const correct = "It is a Syntax Error if the input of a [PipeExpression](#pipeexpression) ends in an open arrow handler: a `CatchExpression` whose handler is an `ArrowHandler` with an expression body, or a `PipeExpression` whose `PipeBody` ends in one."

test("the old blanket exclusion fails even beside the correct recursive rule", () => {
  assert.equal(violations(old + "\n\n" + correct).length, 1)
  assert.deepEqual(violations(correct), [])
})

test("formatting, heading offsets and surrounding rules cannot hide the exclusion", () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 300 }), n => {
    const padding = "\n".repeat(n)
    const wording = n % 2 ? old.replaceAll("`", "") : old
    assert.equal(violations(padding + wording + "\n" + correct)[0].line, n + 1)
    assert.deepEqual(violations(padding + correct), [])
  }), { numRuns: 100, seed: 17 })
})

test("code examples and conditional-only restrictions are outside this rule", () => {
  assert.deepEqual(violations("```text\n" + old + "\n```"), [])
  assert.deepEqual(violations("It is a Syntax Error if the test is a CatchExpression whose handler is an ArrowHandler."), [])
})

test("the published pipe grammar passes", () => {
  const text = readFileSync(new URL("../design/src/900-appendices.md", import.meta.url), "utf8")
  assert.deepEqual(violations(text), [])
})
