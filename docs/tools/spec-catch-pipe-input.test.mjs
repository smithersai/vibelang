// Appendix A gives a catch with an arrow handler one reading before |>, as it
// does before ?: the pipe belongs to the arrow's body (loop round 1, OPUS-1).
// Without the early error, a catch () => b |> % + 1 had two derivations with
// different results.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = process.env.SPEC_CATCH_PIPE_ROOT || fileURLToPath(new URL("../..", import.meta.url))
const read = path => readFileSync(resolve(root, path), "utf8")
const appendix = read("docs/design/src/900-appendices.md")
const running = read("docs/design/src/002-running.md")

test("Appendix A rejects a catch with an arrow handler as a pipe's input", () => {
  assert.match(appendix, /It is a Syntax Error if the `ShortCircuitExpression` of a `PipeExpression` is a `CatchExpression` whose handler is an `ArrowHandler`; the `\|>` then belongs to the arrow's body/)
  assert.match(appendix, /So `a catch \(\) => b \|> % \+ 1` is `a catch \(\(\) => \(b \|> % \+ 1\)\)`/)
})

test("the conditional and pipe edges of an arrow handler agree", () => {
  // Both left-hand consumers of ShortCircuitExpression that can follow an
  // arrow's concise body carry the same restriction.
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
