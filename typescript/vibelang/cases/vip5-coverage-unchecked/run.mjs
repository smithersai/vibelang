import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as reference from "./typescript/out/main.js"
const values = [() => 5, () => undefined, () => Promise.resolve(7), () => [], () => (function* () { return 7 })(), () => Effect.succeed(8), () => (function* () { return yield* Effect.succeed(9) })()]
function normalize(e) {
  if (e._tag === "Success") return ["Success", e.value]
  return ["Failure", e.cause.reasons.map(r => r._tag === "Die" ? ["Die", r.defect instanceof TypeError ? "TypeError" : typeof r.defect] : [r._tag,r.error])]
}
for (const name of ["tail","statement"]) {
  const observed = values.map(make => normalize(Effect.runSyncExit(actual[name](make()))))
  const expected = values.map(make => normalize(Effect.runSyncExit(reference[name](make()))))
  assert.deepEqual(observed,expected,name)
  assert.deepEqual(observed,[
    ["Failure",[["Die","TypeError"]]],["Failure",[["Die","TypeError"]]],["Failure",[["Die","TypeError"]]],
    ["Success",undefined],["Success",7],["Success",8],["Success",9]
  ])
}
console.log("unchecked parity: tail and statement native delegation across seven operands")
