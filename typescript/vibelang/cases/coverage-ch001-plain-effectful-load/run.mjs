import assert from "node:assert/strict"
import { Effect } from "effect"
import { main } from "./out/main.js"
import { main as native, directControl } from "./out/native.js"
const reference = await Effect.runPromiseExit(native())
assert.equal(reference._tag, "Success")
assert.deepEqual(reference.value, {bad:"BadInput",good:"user-u",calls:["u"]})
assert.deepEqual(await Effect.runPromiseExit(main()), reference)
assert.equal((await Effect.runPromiseExit(directControl()))._tag, "Failure")
console.log("coverage-ok")
