import assert from "node:assert/strict"
import { Effect } from "effect"
import { sample } from "./out/main.js"
import { sample as twin } from "./out/twin.js"
const expected = await Effect.runPromise(twin())
assert.deepEqual(expected, [7, 8, 9, 6])
assert.deepEqual(await Effect.runPromise(sample()), expected)
console.log("try newline and member composition match yield*")
