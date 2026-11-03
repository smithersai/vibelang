import assert from "node:assert/strict"
import { Effect } from "effect"
import { main } from "./out/main.js"
import { main as native } from "./out/native.js"
const expected=await Effect.runPromiseExit(native())
assert.equal(expected._tag,"Success")
assert.deepEqual(expected.value,{called:3,indexed:[20,20],shadowed:"local",subtracted:9})
assert.deepEqual(await Effect.runPromiseExit(main()),expected)
console.log("coverage-ok")
