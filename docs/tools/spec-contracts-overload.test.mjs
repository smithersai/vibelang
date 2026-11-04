import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { Cause, Effect } from "effect"
import fc from "fast-check"
import { block, chapter } from "./spec-witness.mjs"
const failures = () => process.env.SPEC_FAILURES ? readFileSync(process.env.SPEC_FAILURES, "utf8") : chapter("003-failures")

test("the current parsed example uses the Effect.try overload its counterpart runs", () => {
  const source = block(failures(), "effect function parsed(s: string)", "vibe es")
  const native = block(failures(), "function parsed(s: string)")
  const bridge = "Effect.try({ try: () => parse(s), catch: () => new BadInput() })"
  assert.ok(source.includes(bridge), "VibeLang source must use the object overload")
  assert.ok(native.includes(bridge), "native counterpart must use the same object overload")
  assert.doesNotMatch(source, /Effect\.try\(\(\) => parse\(/)
  assert.ok(failures().includes("the thunk-only form fails with Effect's `UnknownError`"))
})

test("Effect 4.1.1's thunk overload fails with UnknownError; the object overload keeps the thrown value", () => {
  const keep = () => { throw "boom" }
  const thunk = Effect.runSyncExit(Effect.try(() => keep()))
  const object = Effect.runSyncExit(Effect.try({ try: () => keep(), catch: (error) => error }))
  assert.equal(thunk._tag, "Failure")
  assert.equal(object._tag, "Failure")
  const [thunkReason] = thunk.cause.reasons
  assert.equal(thunkReason._tag, "Fail")
  assert.ok(Cause.isUnknownError(thunkReason.error), String(thunkReason.error))
  assert.deepEqual(object.cause.reasons.map((r) => [r._tag, r.error]), [["Fail", "boom"]])
})

test("fast-check: thunk and identity-map overloads retain distinct failure channels", () => {
  fc.assert(fc.property(fc.jsonValue(), reason => {
    const fail = () => { throw reason }
    const thunk = Effect.runSyncExit(Effect.try(fail))
    const object = Effect.runSyncExit(Effect.try({ try: fail, catch: error => error }))
    assert.equal(thunk._tag, "Failure")
    assert.equal(object._tag, "Failure")
    assert.equal(thunk.cause.reasons[0]._tag, "Fail")
    assert.ok(Cause.isUnknownError(thunk.cause.reasons[0].error))
    assert.equal(object.cause.reasons[0]._tag, "Fail")
    assert.equal(object.cause.reasons[0].error, reason)
  }), { seed: 40028, numRuns: 150 })
})
