import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as reference from "./typescript/out/main.js"
const a = Effect.runSyncExit(actual.main()), b = Effect.runSyncExit(reference.main())
assert.deepEqual(a,b)
assert.equal(a._tag,"Failure")
assert.deepEqual(a.cause.reasons.map(r => [r._tag,r.defect]),[["Die","plain"]])
console.log("plain handler throw is a defect")
