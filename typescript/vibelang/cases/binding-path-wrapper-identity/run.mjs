import assert from "node:assert/strict"
import { Effect } from "effect"
import { make } from "./out/main.js"
import { events, sentinel } from "./out/foreign.js"
const plan = []
for (const bad of [false, true]) for (const [index, program] of make(bad).entries()) plan.push({ bad, index, program })
assert.deepEqual(events, [])
const outcomes = []
for (let repeat = 0; repeat < 2; repeat++) for (const { bad, index, program } of plan) {
  const exit = await Effect.runPromiseExit(program)
  if (!bad) {
    assert.equal(exit._tag, "Success")
    assert.equal(exit.value, index < 4 ? 4 : 7)
    outcomes.push({ repeat, index, value: exit.value })
    continue
  }
  assert.equal(exit._tag, "Failure")
  assert.equal(exit.cause.reasons.length, 1)
  const reason = exit.cause.reasons[0]
  assert.equal(reason._tag, "Fail")
  if (index % 4 < 2) {
    assert.equal(reason.error._tag, "UnknownError")
    assert.equal(reason.error.cause, sentinel)
    outcomes.push({ repeat, index, kind: "wrapped", sentinel: true })
  } else {
    assert.equal(reason.error, sentinel)
    outcomes.push({ repeat, index, kind: "direct", sentinel: true })
  }
}
assert.deepEqual(events, Array(4).fill([...Array(4).fill("sync"), ...Array(4).fill("promise")]).flat())
console.log("binding paths ok")
