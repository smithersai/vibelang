import assert from "node:assert/strict"
import { test } from "node:test"
import { chapter } from "./spec-witness.mjs"

const tooling = chapter("007-tooling")
test("severity keys use whole printed codes, including growing imported ordinals", () => {
  const paragraph = tooling.split("\n").find(line => line.startsWith("`vibe.severities` is a map keyed"))
  assert.ok(paragraph, "missing severity-key contract")
  assert.ok(paragraph.includes("whole strings"), "the key contract must retain the complete printed code")
  assert.ok(paragraph.includes("`EK3801`") && paragraph.includes("`EK38100`"), "four- and five-digit codes remain distinct")
  assert.doesNotMatch(paragraph, /keyed by the `EKxxxx` code/)
})

test("a configuration example retains the five-digit lint code as its key", () => {
  const examples = [...tooling.matchAll(/```json\n([\s\S]*?)```/g)].map(match => JSON.parse(match[1]))
  assert.ok(examples.some(example => example.vibe?.severities?.EK38100 === "warning"), "the config examples omit EK38100")
})
