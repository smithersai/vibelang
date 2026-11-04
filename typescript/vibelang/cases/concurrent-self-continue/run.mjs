import assert from "node:assert/strict"
import { Effect } from "effect"
import { reference } from "./out/reference.js"
import { main } from "./out/main.js"
const expected = {
  values: [2, 3, 2, 2, 2],
  events: ["1:1", "close", "2:1", "close"],
}
assert.deepEqual(await Effect.runPromise(reference()), expected)
assert.deepEqual(await Effect.runPromise(main()), expected)
