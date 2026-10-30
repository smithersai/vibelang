import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"

const running = () => process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")

test("the Promise parity table states native Effect scheduling without forced suspension", () => {
  const row = running().split("\n").find(line => line.startsWith("|") && line.includes("Promise job"))
  assert.match(row, /without suspending/)
  assert.match(row, /Effect's scheduler/)
  assert.match(running(), /unrelated fibers/)
})

test("the printed short references distinguish completed-Effect and Promise turns", () => {
  const result = run(block(running(), "function effectOrder(") + `
import assert from "node:assert/strict"
assert.equal(Effect.runSync(Effect.gen(function* () { return yield* Effect.succeed(7) })), 7)
assert.deepEqual(await Effect.runPromise(effectOrder()), ["after completed", "child", "after yield"])
assert.deepEqual(await promiseOrder(), ["child", "after completed", "after yield"])
`)
  assert.equal(result.status, 0, result.stderr)
})

test("native cooperative scheduling can also run a child during synchronous work", () => {
  const result = run(`
import { Effect } from "effect"
import assert from "node:assert/strict"
let progress = 0
let observed = -1
await Effect.runPromise(Effect.gen(function* () {
  yield* Effect.forkChild(Effect.sync(() => { observed = progress }))
  while (progress < 50000) yield* Effect.sync(() => { progress++ })
}))
assert.ok(observed >= 0 && observed < 50000)
`)
  assert.equal(result.status, 0, result.stderr)
})
