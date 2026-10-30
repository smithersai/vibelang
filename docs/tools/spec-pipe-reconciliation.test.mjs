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

// The pinned SDO returns false at a PipeBody boundary. All other nodes use
// its default recursive rule, with a direct % child producing true.
const containsOuterTopic = node => node.kind !== "PipeBody" &&
  (node.kind === "%" || (node.children || []).some(containsOuterTopic))
const topic = { kind: "%" }
const expr = children => ({ kind: "AssignmentExpression", children })
const pipeBody = child => ({ kind: "PipeBody", children: [child] })
const childErratum = /The missing-topic early error checks `AssignmentExpression`/.test(errata)
const admitted = expression => containsOuterTopic(childErratum ? expression : pipeBody(expression))

for (const [name, expression, expected] of [
  ["a direct topic: 1 |> % + 1", expr([{ kind: "1" }, topic]), true],
  ["a missing topic: 1 |> f()", expr([{ kind: "Call" }]), false],
  ["a nested topic only: 1 |> (2 |> % + 1)", expr([pipeBody(expr([topic]))]), false]
]) {
  test("the adopted pipe early error handles " + name, () => {
    assert.equal(admitted(expression), expected)
  })
}

const appendix = read("docs/design/src/900-appendices.md")
const running = read("docs/design/src/002-running.md")
test("the effective grammar reaches the pipe and gives an unparenthesized chain one left-associated derivation", () => {
  const entry = appendix.match(/^ShortCircuitExpression = (.*)$/m)?.[1]
  assert.match(entry ?? "", /\bPipeExpression\b/)
  assert.match(appendix, /PipeExpression = ShortCircuitExpression "\|>" PipeBody/)
  assert.match(appendix, /whole unparenthesized.*`PipeExpression`/)
  // Reduced atom/pipe fragment only: a whole pipe cannot be the unparenthesized
  // RHS, so each extra stage extends the one left-associated derivation.
  const count = n => n === 1 ? 1 : Array.from({length: n - 1}, (_, i) => {
    const left = i + 1, right = n - left
    return right === 1 ? count(left) : 0
  }).reduce((a, b) => a + b, 0)
  assert.deepEqual([1, 2, 3, 4].map(count), [1, 1, 1, 1])
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
