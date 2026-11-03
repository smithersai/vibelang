import assert from "node:assert/strict"
import { Effect } from "effect"
import { probe } from "./out/main.js"; import { probe as native } from "./out/native.js"
const actual=await Effect.runPromiseExit(Effect.tryPromise(probe)); const reference=await Effect.runPromiseExit(Effect.tryPromise(native))
assert.deepEqual(actual,reference)
assert.equal(actual._tag,"Success")
assert.deepEqual(actual.value,{"afterCall": [6, 0], "values": [{"done": true, "value": 7}, {"done": true, "value": 7}, {"done": true, "value": 7}, {"done": true, "value": 7}, {"done": true, "value": 7}, {"done": true, "value": 7}], "bodies": 0, "prototype": true, "length": 0, "kind": "GeneratorFunction"})
console.log("coverage-ok")
