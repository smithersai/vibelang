import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { Cause, Effect } from "effect"
import { chapter } from "./spec-witness.mjs"
const running = () => process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")

test("catch's mixed-cause explanation does not attribute an unelected failure to try.any", () => {
  const text = running()
  assert.doesNotMatch(text, /as `try.any` gives when an operand dies/)
  assert.match(text, /a `Cause` with both a failure and a defect/)
})

test("native error recovery and defect election differ from the cause's origin", () => {
  for (const [cause, expected] of [
    [Cause.fail("failure"), [["Fail", "failure"]]],
    [Cause.combine(Cause.fail("failure"), Cause.interrupt()), [["Fail", "failure"]]]
  ]) {
    let handled = false
    const exit = Effect.runSyncExit(Effect.catch(Effect.failCause(cause), error => {
      handled = true
      return Effect.succeed(error)
    }))
    assert.equal(handled, true)
    assert.equal(exit._tag, "Success")
    assert.equal(exit.value, expected[0][1])
  }
  const mixed = Cause.combine(Cause.fail("failure"), Cause.die("defect"))
  const result = Effect.runSyncExit(Effect.catch(Effect.failCause(mixed), () => Effect.succeed("handled")))
  assert.deepEqual(result.cause.reasons.map(reason => [reason._tag, reason.defect]), [["Die", "failure"], ["Die", "defect"]])
  const any = Effect.runSyncExit(Effect.raceAll([Effect.fail("failure"), Effect.die("defect")]))
  assert.deepEqual(any.cause.reasons.map(reason => [reason._tag, reason.defect]), [["Die", "failure"], ["Die", "defect"]])
})

test("defect and interruption branches keep native recovery policy and payload identity", () => {
  const defect = { label: "defect" }
  for (const cause of [
    Cause.die(defect),
    Cause.interrupt(),
    Cause.combine(Cause.combine(Cause.fail("failure"), Cause.die(defect)), Cause.interrupt())
  ]) {
    let handled = false
    const exit = Effect.runSyncExit(Effect.catch(Effect.failCause(cause), () => {
      handled = true
      return Effect.succeed("unexpected")
    }))
    assert.equal(handled, false)
    assert.equal(exit._tag, "Failure")
    assert.deepEqual(exit.cause.reasons.map(reason => reason._tag),
      cause.reasons.map(reason => reason._tag === "Fail" ? "Die" : reason._tag))
    const nativeDefect = exit.cause.reasons.find(reason => reason._tag === "Die" && reason.defect === defect)
    if (cause.reasons.some(reason => reason._tag === "Die")) assert.ok(nativeDefect)
  }
})
