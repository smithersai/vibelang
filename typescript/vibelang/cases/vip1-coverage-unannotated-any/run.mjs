import assert from "node:assert/strict"
import { Effect, Exit } from "effect"
import * as actual from "./out/main.js"
import * as reference from "./typescript/out/main.js"
const a = Effect.runSyncExit(actual.main())
const b = Effect.runSyncExit(reference.main())
assert.deepEqual(a, b)
assert.ok(Exit.isSuccess(a))
assert.deepEqual(a.value, true)
console.log(JSON.stringify(a.value))
