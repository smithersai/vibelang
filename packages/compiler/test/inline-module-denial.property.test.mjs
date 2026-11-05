import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { inspectInline, inlineInputs } from "./inline-module-denial.mjs"

const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./property-regressions/alchemy-retired-inline-module.json", import.meta.url), "utf8"))

test("the module-body oracle follows accepted VIP-40", () => {
  const vip = readFileSync(new URL("../../../" + corpus.oracle.source, import.meta.url), "utf8")
  assert.ok(vip.includes(corpus.oracle.quote))
  assert.ok(vip.includes("Replaces denied [VIP-25]"))
})

function check(input, literal) {
  const result = inspectInline(input, literal)
  assert.equal(result.vibe.status, 0, result.key + ": " + result.vibe.output)
  assert.deepEqual(result.vibe.codes, [], result.key)
  assert.equal(result.vibe.output, "", "accepted native bodies have no diagnostics")
}

test("the Alchemy throwing-function body is accepted without rewriting its source", () => check(corpus.input, corpus.source))
test("module bodies accept each retained name and function, const or class export", () => {
  for (const input of inlineInputs()) check(input)
})
test("module-body acceptance retains namespace, extracted-body and TS1141 stock controls across mutations", () => {
  fc.assert(fc.property(fc.record({
    name: fc.constantFrom("pem", "Legacy", "escape"),
    body: fc.constantFrom("function", "const", "class")
  }), check), { seed: 510025, numRuns: 12, endOnFailure: true })
})
