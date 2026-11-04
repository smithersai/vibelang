// docs/design/vips/0034-compiler-and-tooling.md#e3ae0eb4693c052d
// VIP-34: a Stream used by for concurrent gets the owning VIP-19 EK1901.
// run-seconds: 180
import assert from "node:assert/strict"
import {compareTwin,exitView} from "../_cov-tooling-twin.mjs"
await compareTwin(import.meta.url,"main",[[],[1,2,3],[-2,5]],async(fn,E,input)=>{
 const exit=await E.runPromiseExit(fn(input)); assert.equal(exit._tag,"Success"); assert.equal(exit.value,input.reduce((a,b)=>a+b,0));return exitView(exit)
})
console.log("concurrent operand owns EK1901")
