import assert from "node:assert/strict"
import { Effect, Exit } from "effect"
import * as actual from "./out/main.js"
import * as reference from "./typescript/out/main.js"

const result = Effect.runSyncExit(actual.program())
assert.deepEqual(result, Effect.runSyncExit(reference.program()))
assert.ok(Exit.isSuccess(result))
assert.deepEqual(result.value, [4, "ok", 6, 8])
console.log(JSON.stringify(result.value))
