import assert from "node:assert/strict"
import { Effect } from "effect"
import { PlainA, PlainB, SchemaA, SchemaB, plain, schema } from "./out/main.js"

for (const [choose, values] of [
  [plain, [new PlainA({ value: 7 }), new PlainB(), { _tag: "PlainA", value: 8 }, { _tag: "PlainB" }]],
  [(value) => Effect.runSync(schema(value)), [new SchemaA({ value: 7 }), new SchemaB(), { _tag: "SchemaA", value: 8 }, { _tag: "SchemaB" }]]
]) {
  for (const value of values) {
    const [first, second] = choose(value)
    assert.equal(first, value)
    assert.equal(second, value)
  }
}
console.log("error extractor captures")
