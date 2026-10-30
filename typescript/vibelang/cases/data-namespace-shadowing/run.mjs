import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as expected from "./typescript/out/main.js"
assert.equal(actual.Data, "user namespace")
assert.deepEqual(actual.empty, expected.empty)
assert.deepEqual(actual.value, expected.value)
assert.equal(actual.generic(), expected.generic())
const a = await Effect.runPromiseExit(Effect.succeed([actual.empty, actual.value, actual.Data, actual.generic()]))
const b = await Effect.runPromiseExit(Effect.succeed([expected.empty, expected.value, expected.Data, expected.generic()]))
assert.deepEqual(a, b)
console.log("data namespace shadows stay local")
