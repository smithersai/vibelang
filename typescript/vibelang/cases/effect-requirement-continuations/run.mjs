import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as native from "./out/native.js"
assert.deepEqual(native.chained(5), [5, 5])
assert.deepEqual(actual.chained(5), native.chained(5))
assert.equal(native.collect([1, 2, 3]), 6)
assert.equal(actual.collect([1, 2, 3]), native.collect([1, 2, 3]))
for (const key of ["retained", "retainedCheckName"]) {
  assert.equal(Effect.runSync(native[key](Effect.succeed(9))), 9)
  assert.equal(Effect.runSync(actual[key](Effect.succeed(9))), 9)
}
console.log("continuation-ok")
