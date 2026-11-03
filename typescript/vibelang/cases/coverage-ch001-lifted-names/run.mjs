import assert from "node:assert/strict"
import {Effect} from "effect"
import {main} from "./out/main.js"
import {main as native} from "./out/native.js"
const reference=await Effect.runPromiseExit(native())
assert.equal(reference._tag,"Success")
assert.deepEqual(reference.value,{piped:["",""],matched:["",""],completed:["",""]})
assert.deepEqual(await Effect.runPromiseExit(main()),reference)
console.log("coverage-ok")
