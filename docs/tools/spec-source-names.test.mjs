import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"

test("source naming context survives every generated value capture without a post-creation repair", () => {
  const text = chapter("001-functions")
  assert.match(text, /NamedEvaluation/)
  assert.match(text, /pipe topics, `do`\/`match` values and completion records/)
  assert.match(text, /before creation/)
  assert.match(text, /class static initializer/)
  assert.match(text, /source explicitly requests/)
  assert.match(chapter("002-running"), /source-names/)
  assert.match(chapter("008-runtime"), /source-names/)
})

test("the printed names preserve value-only anonymity and requested binding names", () => {
  const result = run(block(chapter("001-functions"), "// Source-name reference controls"))
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), ["", "", "", "named"])
})
