import assert from "node:assert/strict"
import {Schema} from "effect"
import * as V from "./out/main.js"
import * as T from "./typescript/out/main.js"
const names=["Canonical","QualifiedInner","QualifiedOuter","Both","Renamed","CrossA","CrossR","Nested"]
const inputs=[{x:1},{},{x:undefined},{x:"bad"},{x:[1,2]},{x:[]},null,[]]
for(const name of names){
 for(const input of inputs){
  const a=Schema.decodeUnknownExit(V[name])(input)
  const b=Schema.decodeUnknownExit(T[name])(input)
  assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)),name)
 }
 assert.equal(Schema.is(V[name])({}),false,name+" requires x")
}
for(const model of [V,T]){
 const nested=Schema.decodeUnknownSync(model.Nested)({x:[8]})
 nested.x.push(9)
 assert.deepEqual(nested,{x:[8,9]})
}
console.log("ok readonly record bindings")
