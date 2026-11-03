import assert from "node:assert/strict"
import { Effect } from "effect"
import { main } from "./out/main.js"; import { main as native } from "./out/native.js"
const actual=await Effect.runPromiseExit(main()); const reference=await Effect.runPromiseExit(native())
assert.deepEqual(actual,reference)
assert.equal(actual._tag,"Success")
assert.deepEqual(actual.value,7)
