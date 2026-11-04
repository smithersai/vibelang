// Appendix A gives a catch with an arrow handler one reading before |>, as it
// does before ?: the pipe belongs to the arrow's body (loop round 1, OPUS-1).
// Without the early error, a catch () => b |> % + 1 had two derivations with
// different results.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import fc from "fast-check"
import { fileURLToPath } from "node:url"

const root = process.env.SPEC_CATCH_PIPE_ROOT || fileURLToPath(new URL("../..", import.meta.url))
const read = path => readFileSync(resolve(root, path), "utf8")
const appendix = read("docs/design/src/900-appendices.md")
const running = read("docs/design/src/002-running.md")

// VIP-23, the accepted closed-arrow reconciliation, and docs-tools
// disposition 5 distinguish the open right edge from a completed handler.
const openArrowClauses = [
  "input of a [PipeExpression](#pipeexpression) ends in an open arrow handler",
  "an `ArrowHandler` with an expression body",
  "or a `PipeExpression` whose `PipeBody` ends in one",
  "`a catch () => b |> % + 1` is `a catch (() => (b |> % + 1))`",
  "`x |> % catch () => y |> % + 1` is `x |> (% catch (() => (y |> % + 1)))`",
  "Parentheses around the handler or the whole `catch` expression, a `NonArrowHandler` and a block-bodied arrow close the handler",
  "a following `|>` pipes the recovered value",
]
function checkOpenArrowContract(text) {
  const rule = text.split("\n").find(line => line.startsWith("It is a Syntax Error if the input of a [PipeExpression]"))
  assert.ok(rule, "missing open-arrow pipe-input rule")
  for (const clause of openArrowClauses) assert.ok(rule.includes(clause), "missing pipe boundary clause: " + clause)
}

test("Appendix A reserves pipe input only at an open arrow edge", () => {
  checkOpenArrowContract(appendix)
})

test("fast-check: every open and closed pipe boundary clause remains required", () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: openArrowClauses.length - 1 }),
    fc.stringMatching(/^[A-Za-z ]{0,60}$/),
    (index, prose) => {
      checkOpenArrowContract(prose + "\n" + appendix + "\n" + prose)
      const clause = openArrowClauses[index]
      assert.throws(() => checkOpenArrowContract(appendix.replace(clause, "removed boundary clause")), { code: "ERR_ASSERTION" })
    }
  ), { seed: 23005, numRuns: 200 })
})

test("the conditional and pipe edges of an arrow handler agree", () => {
  // An open concise arrow absorbs either following operator; the pipe rule
  // separately permits the closed handlers checked above.
  assert.match(appendix, /It is a Syntax Error if the `ShortCircuitExpression` before `\?` is a `CatchExpression` whose handler is an `ArrowHandler`/)
  assert.match(running, /`a catch \(\) => b \? c : d` means `a catch \(\(\) => \(b \? c : d\)\)`, and `a catch \(\) => b \|> % \+ 1` means `a catch \(\(\) => \(b \|> % \+ 1\)\)`/)
})

test("the chapter's results follow the arrow-body reading", () => {
  // a succeeds with 5, b is 0: the handler never runs, so the body reading
  // gives 5, and the parenthesized catch pipes 5 into % + 1.
  const caught = (a, handler) => (a.ok ? a.value : handler())
  const a = { ok: true, value: 5 }
  const body = caught(a, () => 0 + 1)
  const piped = (topic => topic + 1)(caught(a, () => 0))
  assert.equal(body, 5)
  assert.equal(piped, 6)
  assert.match(running, /with `a` succeeding with `5` and `b` equal to `0` it gives `5`, and `\(a catch \(\) => b\) \|> % \+ 1` gives `6`/)
})
