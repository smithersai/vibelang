import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as reference from "./typescript/out/main.js"
const a=Effect.runSyncExit(actual.main()),b=Effect.runSyncExit(reference.main())
assert.deepEqual(a,b)
assert.equal(a._tag,"Success")
assert.deepEqual(a.value,[true,true])
console.log("custom matcher getter and call exceptions remain implicit defects")
