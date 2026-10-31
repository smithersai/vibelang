import assert from "node:assert/strict"
import { Effect, Exit } from "effect"
import * as actual from "./out/main.js"
import * as reference from "./typescript/out/main.js"

const value = Effect.runSyncExit(actual.x)
assert.deepEqual(value, Effect.runSyncExit(reference.x))
assert.ok(Exit.isSuccess(value))
assert.equal(value.value, 1)
assert.deepEqual([actual.y, actual.z], [reference.y, reference.z])
console.log(JSON.stringify([value.value, actual.y, actual.z]))
