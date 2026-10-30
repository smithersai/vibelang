import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"
const running = () => process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")

test("the numeric limit prose delegates the full domain without a positive-integer restriction", () => {
  const text = running()
  assert.doesNotMatch(text, /Items run at once, or at most .n. at a time with/)
  assert.match(text, /numeric limits below .*1.*sequential/)
  assert.match(text, /without range checks or rounding/)
})

test("the printed native limit reference visits every item on all admitted boundary controls", () => {
  const result = run(block(running(), "function numericLimit(") + `
import assert from "node:assert/strict"
for (const [limit, maximum] of [
  [-Infinity, 1], [-1, 1], [-0, 1], [0, 1], [0.5, 1], [1, 1],
  [2, 2], [2.5, 3], [Infinity, 3], ["unbounded", 3], [NaN, 1]
] as const) {
  const result = await Effect.runPromise(numericLimit(limit))
  assert.deepEqual(result.seen.toSorted((a, b) => a - b), [1, 2, 3])
  assert.equal(result.maximum, maximum)
}
`)
  assert.equal(result.status, 0, result.stderr)
})
