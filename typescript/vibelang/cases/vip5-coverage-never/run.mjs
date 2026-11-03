import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as reference from "./typescript/out/main.js"
assert.deepEqual(Effect.runSyncExit(actual.main()),Effect.runSyncExit(reference.main()))
assert.equal(Effect.runSync(actual.main()),true)
console.log("never operand static admission and untouched control Exit")
