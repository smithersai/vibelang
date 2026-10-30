import assert from "node:assert/strict"
import * as actual from "./out/main.js"
import { reference, events } from "./out/reference.js"
import { Schema, Effect } from "effect"
const inputs = {
 Direct: [{ value: "ok", count: 2 }, {}, { value: undefined, count: 2 }, { value: 1, count: 2 }],
 Nested: [{ child: { value: 3 } }, {}, { child: {} }, { child: { value: undefined } }],
 Outer: [{ _tag: "Outer", child: { value: "ok" } }, { _tag: "Outer", child: {} }, { _tag: "Outer", child: { value: undefined } }],
 Named: [{ value: true }, {}, { value: undefined }, { value: 1 }],
 Mixed: [{ value: "ok" }, {}, { value: undefined }, { value: 1 }],
}
for (const [name, values] of Object.entries(inputs)) {
 const codec = name === "Named" ? actual.N.Named : actual[name]
 for (const value of values) assert.deepEqual(JSON.parse(JSON.stringify(Schema.decodeUnknownExit(codec)(value))), JSON.parse(JSON.stringify(Schema.decodeUnknownExit(reference[name])(value))))
}
assert.deepEqual(actual.events, events)
// Schema errors are Effects too; a plain constructor result stays data (VIP-1).
const made = actual.make()
assert.equal(Effect.isEffect(made), true)
assert.equal(made instanceof actual.Outer, true)
assert.equal(made.label, "kept")
assert.equal(actual.matches(made), true)
console.log("ok")
