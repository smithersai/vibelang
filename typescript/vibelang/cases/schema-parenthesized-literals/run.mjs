import assert from "node:assert/strict"
import { Exit, Schema } from "effect"
import * as actual from "./out/main.js"
import * as expected from "./typescript/out/main.js"
for (const [name, inputs] of [
  ["Words", ["a", "b", "c", "d", null]],
  ["Values", [-1, 2, true, 3n, false, 1]],
  ["Mixed", ["a", "b", null, "c", undefined]],
  ["Grouped", ["a", "b", "c", "d", null]],
  ["GroupedMixed", ["a", "b", null, "c", undefined]],
  ["GroupedArray", [["a", "b", "c"], [], ["d"], null]],
  ["Nested", [{ code: "a" }, { code: "b" }, { code: "c" }]],
]) {
  for (const input of inputs) {
    const a = Schema.decodeUnknownExit(actual[name])(input)
    const b = Schema.decodeUnknownExit(expected[name])(input)
    assert.equal(a._tag, b._tag)
    if (Exit.isSuccess(a)) assert.deepEqual(a.value, b.value)
    else assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)))
  }
}
assert.deepEqual(actual.words, ["a", "b", "c"])
assert.deepEqual(actual.values, [-1, 2, true, 3n])
assert.deepEqual(actual.grouped, ["a", "b", "a", "c"])
assert.equal(actual.mixedMembers.length, 3)
console.log("parenthesized schema literals agree")
