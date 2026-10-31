import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read } from "./spec-witness.mjs"

const rules = JSON.parse(read("typescript/tsc/internal/vibelangfuzz/testdata/tooling-public-citations.json"))

test("tooling cites public rules instead of private numbered decisions", () => {
  assert.doesNotMatch(chapter("007-tooling"), /\b(?:decided )?details? \d/i)
})

test("every tooling citation names an accepted amendment that states its rule", () => {
  const text = chapter("007-tooling")
  assert.equal(rules.length, 15)
  for (const rule of rules) {
    const line = text.split("\n").find(line => line.includes(rule.claim))
    assert.ok(line, `missing ${rule.key}: ${rule.claim}`)
    for (const source of rule.sources) {
      assert.ok(line.includes(`../vips/${source.file}#decision`), `${rule.key}: missing public source`)
      const vip = read(`docs/design/vips/${source.file}`)
      assert.match(vip, /\*\*Status:\*\* accepted/)
      assert.ok(vip.includes(source.heading), `${rule.key}: public source lacks ${source.heading}`)
    }
  }
})
