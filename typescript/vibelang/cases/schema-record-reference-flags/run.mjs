import assert from "node:assert/strict"
import { Schema } from "effect"
import * as V from "./out/main.js"
import * as T from "./typescript/out/main.js"
const inputs = {
 Writable:[{a:1},{},{a:undefined},{a:"bad"}],
 Readonly:[{a:1},{},{a:undefined},{a:"bad"}],
 PresentUndefined:[{a:1},{a:undefined},{},{a:"bad"}],
 ReadonlyArrays:[{a:[1,2]},{a:["bad"]},{},null],
 Nested:[{a:{value:1}},{a:{}},{},null],
 ViaDeclaration:[{a:1},{a:"bad"},{},null]
}
for (const [name, values] of Object.entries(inputs)) {
 for (const input of values) {
  assert.deepEqual(JSON.parse(JSON.stringify(Schema.decodeUnknownExit(V[name])(input))),JSON.parse(JSON.stringify(Schema.decodeUnknownExit(T[name])(input))))
 }
}
assert.equal(Schema.is(V.PresentUndefined)({}),false)
assert.equal(Schema.is(V.PresentUndefined)({a:undefined}),true)
const array=Schema.decodeUnknownSync(V.ReadonlyArrays)({a:[1]})
array.a.push(2)
assert.deepEqual(array.a,[1,2])
console.log("ok Record value flags")
