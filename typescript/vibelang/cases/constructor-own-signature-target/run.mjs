// run-seconds: 30
import assert from "node:assert/strict"
import { Effect, Exit } from "effect"
import * as actual from "./out/main.js"
import * as native from "./typescript/out/main.js"

const actualExit = Effect.runSyncExit(actual.main())
const nativeExit = Effect.runSyncExit(native.main())
assert.deepEqual(actualExit, nativeExit)
assert.equal(Exit.isSuccess(actualExit), true)
console.log("@@result " + JSON.stringify(actualExit.value))
