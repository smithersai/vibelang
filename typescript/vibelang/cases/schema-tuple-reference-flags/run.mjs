import assert from "node:assert/strict"
import { Schema } from "effect"
import * as V from "./out/main.js"
import * as T from "./typescript/out/main.js"
const inputs = {
 Pair:[["x",1],["x"],["x",undefined],[]],
 PresentUndefined:[[1],[undefined],[],["bad"]],
 Nested:[[["x",1]],[["x"]],[],null],
 ObjectSlot:[[{value:1}],[{}],[],null],
 ArraySlot:[[[1,2]],[["bad"]],[],null],
 ViaDeclaration:[[1],[],[undefined],["bad"]]
}
for (const [name, values] of Object.entries(inputs)) {
 for (const input of values) {
  assert.deepEqual(JSON.parse(JSON.stringify(Schema.decodeUnknownExit(V[name])(input))), JSON.parse(JSON.stringify(Schema.decodeUnknownExit(T[name])(input))))
 }
}
assert.equal(Schema.is(V.PresentUndefined)([]),false)
assert.equal(Schema.is(V.PresentUndefined)([undefined]),true)
console.log("ok required tuple reference flags")
