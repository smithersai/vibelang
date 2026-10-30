import assert from "node:assert/strict"
import * as actual from "./out/main.js"
import { reference, events } from "./out/reference.js"
import { Schema, Effect } from "effect"
const inputs = {
 Problem: [{ _tag: "Problem", value: "ok" }, { _tag: "Problem" }, { _tag: "Problem", value: undefined }, { _tag: "Problem", value: 1 }],
 Direct: [{ value: "ok", count: 2 }, {}, { value: undefined, count: 2 }, { value: 1, count: 2 }],
 Nested: [{ child: { value: 3 } }, {}, { child: {} }, { child: { value: undefined } }],
 Named: [{ value: true }, {}, { value: undefined }, { value: 1 }],
}
for (const [name, values] of Object.entries(inputs)) {
 const codec = name === "Named" ? actual.N.Named : actual[name]
 for (const value of values) {
  assert.deepEqual(JSON.parse(JSON.stringify(Schema.decodeUnknownExit(codec)(value))), JSON.parse(JSON.stringify(Schema.decodeUnknownExit(reference[name])(value))))
 }
}
assert.deepEqual(actual.events, events)
const run = value => Effect.isEffect(value) ? Effect.runPromise(value) : Promise.resolve(value)
// VIP-1 plain functions return the error as data. Yieldable schema errors
// also satisfy Effect.isEffect; preserve the constructor result before running
// a legacy program wrapper.
const constructed = actual.make()
const made = constructed instanceof actual.Problem ? constructed : await run(constructed)
assert.ok(made instanceof actual.Problem)
assert.equal(made.label, "kept")
assert.equal(await run(actual.matches(made)), true)
console.log("ok")
