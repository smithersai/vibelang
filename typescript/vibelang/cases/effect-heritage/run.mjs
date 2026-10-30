import assert from "node:assert/strict"
import { Effect, Exit } from "effect"
import * as vibe from "./out/main.js"
import * as reference from "./out/reference.js"

for (const [name, value] of [["Direct", 8], ["Expression", 9]]) {
  const actual = new vibe[name]().read()
  const expected = new reference[name]().read()
  for (let run = 0; run < 2; run++) {
    const actualExit = Effect.runSyncExit(actual)
    assert.deepEqual(actualExit, Effect.runSyncExit(expected))
    assert.ok(Exit.isSuccess(actualExit))
    assert.equal(actualExit.value, value)
  }
}
assert.equal(new vibe.TypeOnly().value, new reference.TypeOnly().value)
assert.deepEqual(Effect.runSyncExit(new vibe.Nested().program), Effect.runSyncExit(new reference.Nested().program))
console.log("effect heritage matches TypeScript")
