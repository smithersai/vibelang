import assert from "node:assert/strict"
import { test } from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

// Loop round 3, OPUS-3 and loop round 1, OPUS-1 (decided detail 246).
test("Appendix A, chapter 2, VIP-23 and the pinned receipt carry both rules", () => {
  const appendix = chapter("900-appendices")
  assert.ok(appendix.includes("It is a Syntax Error if the input of a [PipeExpression](#pipeexpression) ends in an open arrow handler"))
  assert.ok(appendix.includes("`x |> % catch () => y |> % + 1` is `x |> (% catch (() => (y |> % + 1)))`"))
  assert.ok(appendix.includes("a `NonArrowHandler` and a block-bodied arrow close the handler"))
  assert.ok(appendix.includes("arrow bodies, an `EffectArrow` included, reject a body"))
  const running = chapter("002-running")
  assert.ok(running.includes("covering-production errors remain, and an [EffectArrow](900-appendices.md#effectarrow) is an arrow here"))
  assert.ok(running.includes("const bare = 1 |> effect () => % |> [%]"))
  assert.ok(read("docs/design/vips/0023-pipe.md").includes("**Amended 2026-10-31: arrows at the right edge.**"))
  assert.ok(read("docs/design/vips/tc39-pipeline-operator/README.md").includes("an `EffectArrow` included, still apply"))
})

test("the Effect counterpart gives the three printed results", () => {
  const result = run(block(chapter("002-running"), "const rightEdgeExit") + `
import { Exit } from "effect"
if (!Exit.isSuccess(rightEdgeExit) || JSON.stringify(rightEdgeExit.value) !== "[5,6,6]") throw new Error("right edge")
`)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
