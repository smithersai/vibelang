import assert from "node:assert/strict"
import { Effect, Stream } from "effect"
import * as actual from "./out/main.js"
import * as native from "./out/native.js"
async function observe(make, hostile) {
 const old=Object.getOwnPropertyDescriptor(Function.prototype,"bind")
 let reads=0,program
 const problem={hostile:true}
 Object.defineProperty(Function.prototype,"bind",{configurable:true,get(){reads++;if(hostile)throw problem;return old.value}})
 try {program=make()} finally {Object.defineProperty(Function.prototype,"bind",old)}
 return {reads,first:await Effect.runPromise(Stream.runCollect(program)),second:await Effect.runPromise(Stream.runCollect(program))}
}
for(const name of Object.keys(actual)) for(const hostile of [false,true]) {
 const expected=await observe(native[name],hostile)
 assert.equal(expected.reads,0)
 assert.deepEqual(await observe(actual[name],hostile),expected,name)
}
console.log("bind-ok")
