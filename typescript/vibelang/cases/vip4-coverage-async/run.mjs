import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as reference from "./typescript/out/main.js"
const a = await Effect.runPromiseExit(actual.main())
const b = await Effect.runPromiseExit(reference.main())
assert.deepEqual(a,b)
assert.equal(a._tag,"Success")
assert.deepEqual(a.value,["async","arrow","method",7,true,true,8,9])
console.log("async parity: rejection, assimilation and native await data")
