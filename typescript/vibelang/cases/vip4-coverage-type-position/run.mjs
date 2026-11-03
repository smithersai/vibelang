import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as reference from "./typescript/out/main.js"
const a = Effect.runSyncExit(actual.accepted(() => 2, { method: () => 3 }))
const b = Effect.runSyncExit(reference.accepted(() => 2, { method: () => 3 }))
assert.deepEqual(a, b)
assert.equal(a._tag, "Success")
assert.equal(a.value, 5)
console.log("static acceptance")
