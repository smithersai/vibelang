import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read } from "./spec-witness.mjs"

// The pinned explainer gives |> the precedence of => and assignment, looser
// than ?:. PipeExpression is a ShortCircuitExpression alternative, so the one
// place that admits more is the conditional test, which an early error closes.
const conditional = () => chapter("900-appendices").split("<a id=\"conditionalexpression\"></a>")[1].split("<a id=\"closedcatchexpression\"></a>")[0]

test("a pipe as an unparenthesized conditional test is a syntax error", () => {
  const section = conditional()
  assert.match(section, /It is a Syntax Error if the `ShortCircuitExpression` before `\?` is a \[PipeExpression\]\(#pipeexpression\)\./)
  assert.match(section, /x \|> f\(%\) \? 1 : 2 +syntax error: write \(x \|> f\(%\)\) \? 1 : 2 or x \|> \(f\(%\) \? 1 : 2\)/)
  for (const valid of ["(x |> f(%)) ? 1 : 2", "x |> (f(%) ? 1 : 2)", "ok ? x |> % + 1 : 0"]) assert.ok(section.includes("\n" + valid + " "), valid)
})

test("the pipe snapshot receipt lists the conditional-test early error", () => {
  const row = read("docs/design/vips/tc39-pipeline-operator/README.md").split("\n").find(line => line.startsWith("| Grammar entry and chains |"))
  assert.match(row, /A `PipeExpression` as the test of a `ConditionalExpression` is an early error too/)
})
