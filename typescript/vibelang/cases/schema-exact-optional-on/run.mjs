import assert from "node:assert/strict"
import { Schema } from "effect"
import * as V from "./out/main.js"
import * as T from "./typescript/out/main.js"
const exact = true
for (const name of ["S", "E", "T", "U"]) {
 const tuple = name === "T" || name === "U"
 const samples = tuple ? [[], [undefined], ["ok"], ["ok", undefined], [1]] :
  [{}, { plain: undefined }, { plain: "ok" }, { loose: undefined }, { frozen: undefined }, { nested: { value: undefined } }, { converted: "12" }, { converted: undefined }, { broad: undefined }, { anything: undefined }, { plain: 1 }]
 for (const sample of samples) {
  const input = name === "E" ? { _tag: "E", ...sample } : sample
  const actual = Schema.decodeUnknownExit(V[name])(input)
  const expected = Schema.decodeUnknownExit(T[name])(input)
  assert.deepEqual(JSON.parse(JSON.stringify(actual, (_key, value) => value === undefined ? "$undefined" : value)), JSON.parse(JSON.stringify(expected, (_key, value) => value === undefined ? "$undefined" : value)), name + " decoder")
 }
 const input = tuple ? [undefined] : name === "E" ? { _tag: "E", plain: undefined } : { plain: undefined }
 assert.equal(Schema.decodeUnknownExit(V[name])(input)._tag === "Success", !exact, name + " explicit undefined")
 assert.equal(Schema.decodeUnknownExit(V[name])(tuple ? ["ok", undefined] : name === "E" ? { _tag: "E", loose: undefined } : { loose: undefined })._tag === "Success", true)
}
assert.deepEqual(V.D.Ready({ plain: "ok" }), T.D.Ready({ plain: "ok" }))
assert.deepEqual(V.D.Ready({ loose: undefined }), T.D.Ready({ loose: undefined }))
assert.equal(new V.E({})._tag, "E")
console.log("ok exact optional " + exact)
