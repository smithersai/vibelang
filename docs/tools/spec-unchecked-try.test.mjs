import assert from "node:assert/strict"
import { test } from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

test("unchecked try documents native delegation rather than await identity or a dynamic guard", () => {
  const text = chapter("002-running")
  const row = text.split("\n").find(line => line.startsWith("|") && line.includes("noniterable"))
  assert.ok(row, "the await comparison omits unchecked noniterable operands")
  assert.match(row, /TypeError/)
  assert.match(text, /no runtime Effect guard/)
  assert.match(text, /empty iterable/)
})

test("the accepted VIP states the unchecked delegation rule", () => {
  assert.match(read("docs/design/vips/0005-try-runs-effects.md"), /native delegation/)
})

test("the runtime chapter's unchecked operands keep their reference Exits", () => {
  const result = run(block(chapter("008-runtime"), "Unchecked delegation witness"))
  assert.equal(result.status, 0, result.stderr + result.stdout)
})
