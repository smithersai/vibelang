import assert from "node:assert/strict"
import { test } from "node:test"
import { Cause, Effect } from "effect"
import { chapter } from "./spec-witness.mjs"

// Loop round 1, OPUS-4: chapter 2's catch rule, checked against pinned Effect
// over generated Causes rather than one witness. Rule (quoted below): `h` runs
// only when the Cause holds no defect; a Cause with both a failure and a
// defect passes through with its failures re-raised as defects.
const rule = "`h` runs only when the `Cause` holds no defect: a `Cause` with both a failure and a defect"

// A small deterministic PRNG keeps every run's 400 Causes the same.
function prng(seed) {
  let s = seed >>> 0
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32
}

function cause(next, depth) {
  const r = next()
  if (depth === 0 || r < 0.4) {
    const leaf = Math.floor(next() * 3)
    return leaf === 0 ? Cause.fail(`f${Math.floor(next() * 4)}`) : leaf === 1 ? Cause.die(`d${Math.floor(next() * 4)}`) : Cause.interrupt()
  }
  return Cause.combine(cause(next, depth - 1), cause(next, depth - 1))
}

test("chapter 2 states the catch rule the property checks", () => {
  assert.ok(chapter("002-running").includes(rule), rule)
})

test("Effect.catch runs its handler iff the Cause has a failure and no defect, else re-raises failures as defects", () => {
  const next = prng(20261031)
  for (let i = 0; i < 400; i++) {
    const c = cause(next, 3)
    const tags = c.reasons.map((reason) => reason._tag)
    let handled = false
    const exit = Effect.runSyncExit(Effect.catch(Effect.failCause(c), () => {
      handled = true
      return Effect.succeed("handled")
    }))
    const want = tags.includes("Fail") && !tags.includes("Die")
    assert.equal(handled, want, `handler ran=${handled} for ${tags.join(",")}`)
    if (want) {
      assert.equal(exit._tag, "Success")
      continue
    }
    assert.equal(exit._tag, "Failure")
    assert.deepEqual(exit.cause.reasons.map((reason) => reason._tag), tags.map((tag) => (tag === "Fail" ? "Die" : tag)), tags.join(","))
  }
})
