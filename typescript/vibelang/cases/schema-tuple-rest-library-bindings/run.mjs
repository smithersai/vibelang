import assert from "node:assert/strict"
import {Schema} from "effect"
import * as V from "./out/main.js"
import * as T from "./typescript/out/main.js"
const names=["Qualified","QualifiedFrozen","Renamed","Swapped","Grouped","Label","Trailing","Mutable","Nested"]
const inputs=[[],[1],[1,2],["s",true],["s",1,true],["s","bad",true],[[1],[2,3]],[["bad"]],null,{}]
for(const name of names) for(const input of inputs) {
 const v=Schema.decodeUnknownExit(V[name])(input)
 const t=Schema.decodeUnknownExit(T[name])(input)
 assert.deepEqual(JSON.parse(JSON.stringify(v)),JSON.parse(JSON.stringify(t)),name)
}
for(const model of [V,T]) {
 const mutable=Schema.decodeUnknownSync(model.Mutable)([1]);mutable.push(2)
 assert.deepEqual(mutable,[1,2])
 const nested=Schema.decodeUnknownSync(model.Nested)([[1]]);nested[0].push(2)
 assert.deepEqual(nested,[[1,2]])
}
console.log("ok tuple rest library bindings")
