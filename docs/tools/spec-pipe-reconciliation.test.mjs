import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import test from "node:test"

const root = process.env.SPEC_PIPE_ROOT || fileURLToPath(new URL("../..", import.meta.url))
const read = path => readFileSync(resolve(root, path), "utf8")
const snapshot = read("docs/design/vips/tc39-pipeline-operator/spec.html")
const errata = read("docs/design/vips/tc39-pipeline-operator/README.md")
assert.match(snapshot, /<emu-grammar>PipeBody : AssignmentExpression<\/emu-grammar>\s*<emu-alg>\s*1\. Return \*false\*\./)
assert.match(snapshot, /It is a Syntax Error if \|PipeBody\| ContainsOuterTopic is \*false\*\./)

const appendix = read("docs/design/src/900-appendices.md")
const running = read("docs/design/src/002-running.md")
test("the effective grammar reaches the pipe and gives an unparenthesized chain one left-associated derivation", () => {
  const entry = appendix.match(/^ShortCircuitExpression = (.*)$/m)?.[1]
  assert.match(entry ?? "", /\bPipeExpression\b/)
  assert.match(appendix, /PipeExpression = ShortCircuitExpression "\|>" PipeBody/)
  assert.match(appendix, /whole unparenthesized.*`PipeExpression`/)

})

test("all adopted pipe reconciliations agree across the snapshot receipt and both chapters", () => {
  for (const source of [errata, appendix, running]) {
    assert.match(source, /ContainsOuterTopic/)
    assert.match(source, /ShortCircuitExpression/)
    assert.match(source, /topicEnv\.\[\[TopicValues\]\]/)
    assert.match(source, /`\^`/)
  }
  assert.match(snapshot, /Let _topicValues_ be _envRec_\.\[\[TopicValues\]\]/, "retain the untouched upstream typo")
  assert.match(snapshot, /PipeExpression : ConditionalExpression/, "retain the untouched upstream evaluator")
})

test("the printed pipe counterparts preserve topic scope, conditional precedence, identity, XOR and modulo", async () => {
  const { block, run } = await import("./spec-witness.mjs")
  const result = run(block(running, "// Pipe reconciliation controls"))
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), [2, 4, 4, 1, 11, 7, true, 2, 2, 3])
})
