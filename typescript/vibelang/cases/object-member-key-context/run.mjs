import assert from "node:assert/strict"
import { Effect } from "effect"
import * as Actual from "./out/main.js"
import * as Native from "./out/native.js"
const actual = Actual.main(), native = Native.main()
assert.deepEqual(Actual.events, [])
assert.deepEqual(Native.events, [])
for (let i = 0; i < 2; i++) {
 assert.deepEqual(await Effect.runPromiseExit(actual), await Effect.runPromiseExit(native))
 assert.deepEqual(Actual.events, Native.events)
 assert.deepEqual(Actual.events, Array.from({length:i+1},()=>["value1","coerce1","value2"]).flat())
}
console.log("object-key-ok")
