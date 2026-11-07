import assert from "node:assert/strict"
import { Effect } from "effect"
import { visit } from "./out/main.js"
import { visit as reference } from "./out/reference.js"

const limits = [-Infinity, -2, -1, 0, -0, 0.25, 0.5, 0.999, NaN, 1, 1.5, 2, 2.5, 3, 5, 7, Infinity, "unbounded"]
const run = async (f, limit) => {
  const exit = await Effect.runPromiseExit(f(limit))
  assert.equal(exit._tag, "Success", `${String(limit)}: ${JSON.stringify(exit)}`)
  return exit.value
}
const all = [1, 2, 3, 4, 5]
const one = await run(visit, 1)
// Concurrency 1: in order, one at a time, every item on the enclosing fiber.
assert.deepEqual(one, { started: all, finished: all, onParent: all.map(() => true), peak: 1 })
for (const limit of limits) {
  const got = await run(visit, limit)
  // Same visitation, peak and fiber identity as Effect.forEach on that limit.
  assert.deepEqual(got, await run(reference, limit), String(limit))
  // Every limit visits every item: a zero or negative limit skips none.
  assert.deepEqual([...got.finished].sort(), all, String(limit))
  if (typeof limit === "number" && limit < 1) {
    // Below 1: sequential, exactly as 1.
    assert.deepEqual(got, one, String(limit))
  } else if (Number.isInteger(limit) && limit > 1) {
    // Positive integers bound the items active at once, and fork per item.
    assert.equal(got.peak, Math.min(limit, all.length), String(limit))
    assert.deepEqual(got.onParent, all.map(() => false), String(limit))
  } else if (limit === "unbounded" || limit === Infinity) {
    assert.equal(got.peak, all.length, String(limit))
    assert.deepEqual(got.onParent, all.map(() => false), String(limit))
  }
}
// "unbounded" and 2 fork per item; 1 does not.
assert.ok((await run(visit, 2)).onParent.every((x) => !x))
assert.ok((await run(visit, "unbounded")).onParent.every((x) => !x))
console.log("for concurrent matches Effect.forEach on every numeric limit")
