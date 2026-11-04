// run-seconds: 180
import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {compareTwin,exitView} from "../_cov-tooling-twin.mjs"
await compareTwin(import.meta.url,"unsafe",[0],async(fn,E)=>{
const events=[];const resource={[Symbol.dispose](){events.push("dispose")}}
const exit=await E.runPromiseExit(fn(resource));return {exit:exitView(exit),events}
})
const checked=spawnSync(process.env.VIBELANG_BINARY,["-p",".","--pretty","false","--noEmit"],{cwd:new URL(".",import.meta.url),encoding:"utf8",timeout:30000})
assert.ifError(checked.error);assert.equal(checked.status,0,checked.stdout+checked.stderr)
assert.match(checked.stdout+checked.stderr,/warning EK0801:/)
console.log("compiler-and-tooling-using-meaning")
