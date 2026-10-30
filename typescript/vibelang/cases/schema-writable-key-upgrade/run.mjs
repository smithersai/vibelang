import assert from "node:assert/strict"
import * as actual from "./out/main.js"
import {reference} from "./out/reference.js"
import {Schema} from "effect"
const inputs={
 Legacy:[{value:1,nested:{count:2},list:[]},{value:1,maybe:undefined,nested:{count:2},list:["bad"]},{value:1,list:[]}],
 Ref:[{value:1,count:2},{value:"bad",count:2},{}],
 Alias:[[{value:1}],[{value:"bad"}],[]],
 Scoped:[{value:1,count:2},{value:"bad",count:2},{}],
 Root:[{_tag:"Root",nested:{value:1,count:2}},{_tag:"Root",nested:{value:"bad",count:2}},{_tag:"Root"}],
}
const normalize=value=>JSON.parse(JSON.stringify(value))
for(const [name,values]of Object.entries(inputs))for(const value of values)
 assert.deepEqual(normalize(Schema.decodeUnknownExit(name==="Scoped"?actual.N.Scoped:actual[name])(value)),normalize(Schema.decodeUnknownExit(reference[name])(value)))
assert.equal(actual.sameCodec,true)
assert.equal(actual.Ref.fields.value,actual.Mutable)
assert.equal(actual.N.Scoped.fields.value,actual.Mutable)
assert.deepEqual(actual.events,["number"])
const made=actual.make()
assert.equal(made.label,"kept")
assert.equal(actual.matches(made),true)
console.log("ok")
