import assert from "node:assert/strict"
import { Exit, Schema } from "effect"
import * as actual from "./out/main.js"
import * as expected from "./typescript/out/main.js"
for (const [name, inputs] of [
  ["Grouped", [{}, { a: 1, b: 2 }, { a: "bad" }, null]],
  ["Nested", [{ dict: { a: 1, b: 2 } }, { dict: { a: 1 } }, { dict: { a: 1, b: 2, c: 3 } }, { dict: { a: "bad", b: 2 } }, null]],
]) {
  for (const input of inputs) {
    const a = Schema.decodeUnknownExit(actual[name])(input)
    const b = Schema.decodeUnknownExit(expected[name])(input)
    assert.equal(a._tag, b._tag)
    if (Exit.isSuccess(a)) assert.deepEqual(a.value, b.value)
    else assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)))
  }
}
console.log("grouped readonly records agree")
