import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { Effect } from "effect"
import { main, ordinary } from "./out/main.js"
import { main as twin, ordinary as nativeOrdinary } from "./typescript/out/main.js"
const fc = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))("fast-check")
fc.assert(fc.property(fc.integer({ min: -100, max: 100 }), fc.string(), (value, reason) => {
  assert.equal(ordinary(reason), nativeOrdinary(reason))
  const actual = Effect.runSyncExit(main(value, reason))
  const expected = Effect.runSyncExit(twin(value, reason))
  assert.equal(actual._tag, value < 0 ? "Failure" : "Success")
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)))
  if (actual._tag === "Success") assert.equal(actual.value, value)
}), { seed: 48154409, numRuns: 100, examples: [[7, "intended"], [-1, "intended"], [0, ""]] })
console.log("compatibility advice uses try")
