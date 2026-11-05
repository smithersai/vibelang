import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { Effect, Layer } from "effect"
import * as vibe from "./out/main.js"
import * as twin from "./out/twin.js"

const names = ["bareCatch", "tried", "piped", "pipeCatch", "nestedCatch", "instance"]
const differences = []
const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const fc = require("fast-check")
function compare(mode, value) {
  const calls = []
  const live = Layer.succeed(vibe.Audit, {
    record: (message) => {
      calls.push(message)
      return mode === "failure" ? Effect.fail(new vibe.Refused({ message: "refused" }))
        : mode === "defect" ? Effect.die(new Error("defect")) : Effect.succeed(value)
    },
  })
  for (const name of names) {
    calls.length = 0
    const operation = vibe[name]()
    assert.deepEqual(calls, [], name + " is cold")
    const actual = Effect.runSyncExit(Effect.provide(operation, live))
    const actualCalls = [...calls]
    calls.length = 0
    const expected = Effect.runSyncExit(Effect.provide(twin[name](), live))
    // Exit equivalence checks the typed failure channel, not only the success.
    try {
      assert.deepEqual(actual, expected, name + " mode=" + mode)
      assert.deepEqual(actualCalls, calls, name + " evaluates exactly once")
    } catch (error) {
      differences.push(error)
      console.error(name, mode, "actual:", JSON.stringify(actual), "twin:", JSON.stringify(expected))
    }
  }
}
for (const mode of ["success", "failure", "defect"]) compare(mode, 41)
// VIP-10 requires an explicit implementation lookup before member calls.
fc.assert(fc.property(fc.constantFrom("success", "failure", "defect"), fc.integer(), compare),
  { seed: 1009, numRuns: 60 })
if (differences.length) throw new AggregateError(differences, differences.length + " Exit/call differences")
console.log("service run heads match their Effect twins")
