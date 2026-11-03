import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as native from "./out/native.js"
// Native logical assignments are the oracle. Only no-jump do expressions
// become IIFEs in the twin; getter/setter behavior stays native.
const expected = native.probe()
assert.equal(expected.length, 168)
assert.deepEqual(expected[0], { result: 7, state: 107, events: ["get:0", "rhs", "set:7"], error: null })
assert.deepEqual(actual.probe(), expected)
for (const n of [0, 2, undefined]) {
  assert.equal(actual.localOr(n), native.localOr(n))
  assert.equal(actual.localAnd(n), native.localAnd(n))
  assert.equal(actual.localNull(n), native.localNull(n))
}
assert.equal(actual.localNull(null), native.localNull(null))
for (const s of ["text", "", undefined]) {
  for (const name of ["condition", "compared", "typed", "negated", "predicateBoundary"]) {
    assert.equal(actual[name](s), native[name](s))
  }
}
assert.equal(actual.typed(2), native.typed(2))
assert.deepEqual(Effect.runSync(actual.effectProbe()), Effect.runSync(native.effectProbe()))
console.log("168 accessor probes, 10 local controls, 16 conditional controls, Effect control")
