import assert from "node:assert/strict"
import { Effect } from "effect"
import { effectArm } from "./out/main.js"

assert.equal(Effect.runSync(effectArm(true)), 1)
const failed = Effect.runSyncExit(effectArm(false))
assert.equal(failed._tag, "Failure")
assert.equal(failed.cause.reasons.length, 1)
assert.equal(failed.cause.reasons[0]._tag, "Fail")
assert.equal(failed.cause.reasons[0].error, "missing")
console.log("typed Effect failure preserved")
