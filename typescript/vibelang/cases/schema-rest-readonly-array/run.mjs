import assert from "node:assert/strict"
import { Schema } from "effect"
import * as V from "./out/main.js"
import * as T from "./typescript/out/main.js"
const inputs = [["x"], ["x", 1, 2], ["x", "bad"], []]
for (const name of ["ReadonlyRest", "MutableRest", "GenericReadonlyRest", "GenericMutableRest"]) {
  const actual = inputs.map((input) => Schema.decodeUnknownExit(V[name])(input))
  const expected = inputs.map((input) => Schema.decodeUnknownExit(T[name])(input))
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)))
}
console.log("ok readonly rest arrays")
