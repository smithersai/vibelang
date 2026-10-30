import assert from "node:assert/strict"
import { Effect, Exit } from "effect"
import * as vibe from "./out/main.js"
import * as reference from "./out/reference.js"

const actual = vibe.main()
const expected = reference.main()
assert.deepEqual(vibe.calls, [])
assert.deepEqual(reference.calls, [])
for (let run = 0; run < 2; run++) {
  const actualExit = Effect.runSyncExit(actual)
  const expectedExit = Effect.runSyncExit(expected)
  assert.deepEqual(actualExit, expectedExit)
  assert.ok(Exit.isSuccess(actualExit))
  assert.deepEqual(actualExit.value, {
    classValue: 5, staticValue: 7, objectValue: 9, genericValue: "ok", namedEffect: 11,
  })
  assert.deepEqual(vibe.calls, reference.calls)
}
assert.deepEqual(vibe.calls, ["method", "method", "method", "method"])
console.log("computed methods match Effect.gen")
