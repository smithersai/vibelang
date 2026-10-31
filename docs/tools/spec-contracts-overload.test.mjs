import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { Cause, Effect } from "effect"
import { block, chapter } from "./spec-witness.mjs"
const failures = () => process.env.SPEC_FAILURES ? readFileSync(process.env.SPEC_FAILURES, "utf8") : chapter("003-failures")

test("the contracts example uses the Effect.try overload its counterpart runs", () => {
  const source = block(failures(), "effect function contracts()", "vibe es")
  const native = block(failures(), "const genericContract =")
  const bridge = "Effect.try({ try: () => keep(succeed(1)), catch: (error) => error })"
  assert.ok(native.includes("Effect.try({ try: () => keep(Effect.succeed(1)), catch: (error) => error })"))
  assert.ok(source.includes(bridge), "the VibeLang source must use the object overload, as the counterpart does")
  assert.doesNotMatch(source, /Effect\.try\(\(\) => keep\(/)
  assert.ok(native.includes("const constrainedContract ="))
  assert.ok(source.includes("try passEffect(succeed(2))"), "constrainedContract needs its VibeLang source")
})

test("Effect 4.1.0's thunk overload fails with UnknownError; the object overload keeps the thrown value", () => {
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
