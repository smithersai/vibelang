import assert from "node:assert/strict"
import { Effect } from "effect"
import { sample } from "./out/main.js"
import { sample as twin } from "./out/twin.js"
const expected = await Effect.runPromise(twin())
assert.deepEqual(expected, [true, true, true, true, 8, 4, 0])
assert.deepEqual(await Effect.runPromise(sample()), expected)
console.log("plain function catch results match Effect.succeed")
