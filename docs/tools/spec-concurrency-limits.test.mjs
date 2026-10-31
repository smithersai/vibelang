import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { Effect } from "effect"
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

// Effect 4.1.0's forEach resolves a numeric limit with Math.max(1, n) and runs sequentially only when that is 1.
function pulls(limit) {
  const trace = []
  function* items() {
    try { for (let item = 0; item < 3; item++) { trace.push("pull:" + item); yield item } } finally { trace.push("close") }
  }
  const iterator = items()
  Effect.runSyncExit(Effect.forEach(iterator, (item) => Effect.sync(() => { trace.push("item:" + item) }), { concurrency: limit, discard: true }))
  iterator.return()
  return trace[1] === "item:0" ? "incremental" : "materialized"
}

function ownership(limit) {
  return Effect.runPromise(Effect.gen(function* () {
    const interrupted = []
    yield* Effect.forEach([1, 2], () => Effect.gen(function* () {
      yield* Effect.forkChild(Effect.onInterrupt(Effect.never, () => Effect.sync(() => { interrupted.push(true) })))
      yield* Effect.yieldNow
    }), { concurrency: limit, discard: true })
    yield* Effect.yieldNow
    return interrupted.length === 0 ? "enclosing" : "item"
  }))
}

test("the sequential branch is exactly the limits Effect resolves to 1, NaN included in the parallel branch", async () => {
  const text = running()
  assert.match(text, /resolves a numeric limit `n` to `Math\.max\(1, n\)` and takes its sequential branch exactly when that is `1`/)
  assert.match(text, /Every other limit, `NaN` and `"unbounded"` included, takes its parallel branch/)
  assert.match(text, /In the parallel branch, which every limit not resolving to `1` takes, `NaN` included/)
  assert.doesNotMatch(text, /a limit above 1, or `"unbounded"`, forks one fiber per item/, "NaN is neither above nor at or below 1")
  assert.ok(text.includes("for concurrent(NaN) (const id of ids)"))
  for (const limit of [-Infinity, -1, -0, 0, 0.5, 1, 1.5, 2, 2.5, Infinity, NaN, "unbounded"]) {
    const sequential = limit !== "unbounded" && Math.max(1, limit) === 1
    assert.equal(pulls(limit), sequential ? "incremental" : "materialized", `pulling at ${limit}`)
    assert.equal(await ownership(limit), sequential ? "enclosing" : "item", `child ownership at ${limit}`)
  }
})
