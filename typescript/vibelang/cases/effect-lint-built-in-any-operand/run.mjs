// run-seconds: 180
import assert from "node:assert/strict"
import {compareTwin,exitView} from "../_cov-tooling-twin.mjs"
await compareTwin(import.meta.url,"main",[null,0,42,{},false,{valid:7}],async(fn,E,value)=>{
const valid=value!==null&&typeof value==="object"&&Object.hasOwn(value,"valid")
const exit=await E.runPromiseExit(fn(valid?E.succeed(value.valid):value))
if(valid){assert.equal(exit._tag,"Success");assert.equal(exit.value,value.valid)}
else{assert.equal(exit._tag,"Failure");assert.deepEqual(exitView(exit).reasons,["Die"])}
return exitView(exit)
})
console.log("effect-lint-built-in-any-operand")
