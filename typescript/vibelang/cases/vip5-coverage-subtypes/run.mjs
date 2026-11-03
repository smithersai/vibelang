import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as reference from "./typescript/out/main.js"
const a = Effect.runSyncExit(actual.main())
const b = Effect.runSyncExit(reference.main())
assert.deepEqual(a,b)
assert.equal(a._tag,"Success")
assert.deepEqual(a.value,[8,7,4,5,6])
console.log("subtype parity: Exit, Config, Effectable, branded Effect and explicit adapter")
