import assert from "node:assert/strict"
import * as actual from "./out/main.js"
import { Schema } from "effect"
import { reference } from "./out/reference.js"

const inputs = {
  Alias: ["ok", 1],
  Lists: [[], ["ok"], [1]],
  Shape: [
    { item: "ok", list: [["x"]], record: { x: "x" }, literal: "Base<>", "Base<>": "key" },
    { item: 1, list: [], record: {}, literal: "no" },
  ],
  Malformed: [{ _tag: "Malformed", value: "ok" }, { _tag: "Malformed", value: 1 }],
}
for (const [name, values] of Object.entries(inputs)) {
  for (const value of values) {
    const got = Schema.decodeUnknownExit(actual[name])(value)
    const want = Schema.decodeUnknownExit(reference[name])(value)
    assert.deepEqual(JSON.parse(JSON.stringify(got)), JSON.parse(JSON.stringify(want)), name)
  }
}
assert.equal(actual.Alias, actual.Base)
assert.equal(actual.N.Alias, actual.Base)
assert.equal(actual.Shape.fields.item, actual.Base)
console.log("ok")
