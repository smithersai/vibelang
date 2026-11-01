import assert from "node:assert/strict"
import * as actual from "./out/main.js"
import { reference, events } from "./out/reference.js"
import { Schema, Effect } from "effect"
const inputs = {
  Direct: [{}, { value: undefined }, { value: 7 }],
  Nested: [{ child: {} }, { child: { value: undefined } }, { child: { value: 7 } }],
  Outer: [{ _tag: "Outer", child: {} }, { _tag: "Outer", child: { value: undefined } }],
  Named: [{}, { value: undefined }, { value: 7 }],
}
for (const [name, values] of Object.entries(inputs)) {
  for (const value of values) {
    const codec = name === "Named" ? actual.N.Named : actual[name]
    const got = Schema.decodeUnknownExit(codec)(value)
    const want = Schema.decodeUnknownExit(reference[name])(value)
    assert.deepEqual(JSON.parse(JSON.stringify(got)), JSON.parse(JSON.stringify(want)), name)
  }
}
assert.deepEqual(actual.events, events)
// make and matches are plain functions (VIP-1); the schema error instance
// make returns is yieldable, so it is used as it is, never run.
const made = actual.make()
assert.equal(made.label, "kept")
assert.equal(actual.matches(made), true)
console.log("ok")
