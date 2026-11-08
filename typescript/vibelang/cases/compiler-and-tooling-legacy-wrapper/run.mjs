// docs/design/vips/0034-compiler-and-tooling.md#1201c82921527c11
// VIP-34: legacy wrapper execution phase.
// run-seconds: 180
import assert from "node:assert/strict"
import {compareTwin,exitView} from "../_cov-tooling-twin.mjs"
import {checkRunPhase} from "../_cov-tooling-run-phase.mjs"
await compareTwin(import.meta.url,"main",[null],async(fn,E)=>{const outer=await E.runPromiseExit(fn());assert.equal(outer._tag,"Success");assert.equal(E.isEffect(outer.value),true);const inner=await E.runPromiseExit(outer.value);assert.equal(inner._tag,"Success");assert.equal(inner.value,7);return [outer._tag,exitView(inner)]})
console.log("compiler-and-tooling-legacy-wrapper")
