import assert from "node:assert/strict"
import * as actual from "./out/main.js"
import {reference} from "./out/reference.js"
import {Schema,Effect} from "effect"
const inputs={
 Grouped:["a","b",null,"c",0],
 IndividuallyGrouped:["a","b","c",null],
 Row:[["a"],[null],[],["bad"]],
 Dict:[{a:"a",b:null},{a:"bad"},{}],
 Named:["x","y",null,"bad"],
 Deep:[["a","b","c",null],["bad"],[]],
 Payload:[{first:"x",choice:"a",last:1},{first:"x",choice:null,last:1},{first:"x",last:1},{first:1,choice:"bad",last:"x"}],
 Root:[{_tag:"Root",value:"a"},{_tag:"Root",value:null},{_tag:"Root"},{_tag:"Root",value:"bad"}],
}
for(const [name,values] of Object.entries(inputs)) for(const value of values)
 assert.deepEqual(JSON.parse(JSON.stringify(Schema.decodeUnknownExit(name==="Named"?actual.N.Choice:actual[name])(value))),JSON.parse(JSON.stringify(Schema.decodeUnknownExit(reference[name])(value))))
assert.equal(actual.Grouped.members.length,2)
assert.equal(actual.Grouped.members[0].literals.length,2)
assert.equal(actual.IndividuallyGrouped.members.length,2)
assert.deepEqual(actual.events,["first","last"])
const run=value=>Effect.isEffect(value)?Effect.runPromise(value):Promise.resolve(value)
const made=actual.make()
assert.equal(made.label,"kept")
assert.equal(await run(actual.matches(made)),true)
console.log("ok")
