import assert from "node:assert/strict"
import { Effect, Exit } from "effect"
import { choose, effectChoose } from "./out/main.js"
assert.equal(choose(true), 1)
assert.equal(choose(false), 0)
assert.throws(() => choose(null), (e) => e instanceof TypeError && e.message === "")
for (const value of [true, false]) assert.equal(Effect.runSync(effectChoose(value)), value ? 1 : 0)
const failed = Effect.runSyncExit(effectChoose(null))
assert(Exit.isFailure(failed))
const reasons = failed.cause.reasons
assert.equal(reasons.length, 1)
assert.equal(reasons[0]._tag, "Die")
assert(reasons[0].defect instanceof TypeError)
assert.equal(reasons[0].defect.message, "")
console.log("fallback preserved")
