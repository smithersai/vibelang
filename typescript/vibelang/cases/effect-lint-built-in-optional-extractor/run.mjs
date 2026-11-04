// run-seconds: 180
import assert from "node:assert/strict"
import {compareTwin,exitView} from "../_cov-tooling-twin.mjs"
await compareTwin(import.meta.url,"main",[0],async(fn,E)=>{const e=await E.runPromiseExit(fn());assert.equal(e._tag,"Success");assert.equal(e.value,1);return exitView(e)})
console.log("effect-lint-built-in-optional-extractor")
