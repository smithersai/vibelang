import assert from "node:assert/strict"
import { Effect } from "effect"
import * as vibe from "./out/main.js"
import * as reference from "./out/reference.js"

// TypeScript accepts bigint method declarations but does not expose their
// keys to typed numeric indexing. Call both counterparts from JavaScript.
const values = (source) => Effect.all([
  new source.Numbers()[1](2),
  source.Numbers[1000]("ok"),
  source.numbers[2](4),
])
const actual = Effect.runSyncExit(values(vibe))
const expected = Effect.runSyncExit(values(reference))
assert.deepEqual(actual, expected)
assert.equal(actual._tag, "Success")
assert.deepEqual(actual.value, [5, "ok", 9])
console.log("bigint methods match Effect.gen")
