import assert from "node:assert/strict"
import * as actual from "./out/main.js"
import { reference, events } from "./out/reference.js"
import { Schema, Effect } from "effect"
const inputs = {
 Direct: [{ value: 7 }, { value: 7, maybe: undefined }, {}, { value: "bad" }],
 Nested: [{ child: { value: 7 } }, { child: {} }, {}, { child: { value: "bad" } }],
 Outer: [{ _tag: "Outer", child: { value: 7 } }, { _tag: "Outer", child: {} }, { _tag: "Outer", child: { value: "bad" } }],
 Named: [{ value: 7 }, {}, { value: undefined }, { value: "bad" }],
}
for (const [name, values] of Object.entries(inputs)) {
 const codec = name === "Named" ? actual.N.Named : actual[name]
 for (const value of values) {
  assert.deepEqual(JSON.parse(JSON.stringify(Schema.decodeUnknownExit(codec)(value))), JSON.parse(JSON.stringify(Schema.decodeUnknownExit(reference[name])(value))))
 }
}
assert.deepEqual(actual.events, events)
// make and matches are plain functions (VIP-1); the schema error instance
// make returns is yieldable, so it is used as it is, never run.
const made = actual.make()
assert.equal(made.label, "kept")
assert.equal(actual.matches(made), true)
console.log("ok")
