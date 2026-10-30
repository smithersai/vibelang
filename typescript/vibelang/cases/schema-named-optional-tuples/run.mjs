import assert from "node:assert/strict"
import { Effect, Schema } from "effect"
import * as V from "./out/main.js"
import * as T from "./typescript/out/main.js"
const inputs = [[], ["x"], ["x", undefined], ["x", 2], ["x", "bad"], ["x", 2, 3]]
for (const name of ["Optional", "NamedOptional", "Mutable"]) {
  for (const input of inputs) {
    const actual = Schema.decodeUnknownExit(V[name])(input)
    const expected = Schema.decodeUnknownExit(T[name])(input)
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)))
  }
  assert.equal(Schema.is(V[name])(["x", undefined]), true)
}
assert.deepEqual(await Effect.runPromise(V.main()), await Effect.runPromise(T.main()))
console.log("ok optional tuple undefined")
