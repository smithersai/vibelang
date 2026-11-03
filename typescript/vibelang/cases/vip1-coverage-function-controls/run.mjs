import assert from "node:assert/strict"
import { Effect, Exit } from "effect"
import * as actual from "./out/main.js"
import * as reference from "./typescript/out/main.js"
const a = Effect.runSyncExit(actual.main())
assert.deepEqual(a, Effect.runSyncExit(reference.main()))
assert.ok(Exit.isSuccess(a))
console.log(JSON.stringify(a.value))
