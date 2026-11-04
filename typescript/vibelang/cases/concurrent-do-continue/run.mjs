import assert from "node:assert/strict"
import { Effect } from "effect"
import { main } from "./out/main.js"
import { reference } from "./out/reference.js"
const expected = [7, 7, 7, 7, 14, 7, 7]
assert.deepEqual(await Effect.runPromise(reference()), expected)
assert.deepEqual(await Effect.runPromise(main()), expected)
