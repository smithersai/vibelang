// docs/design/vips/0034-compiler-and-tooling.md#fa20a2c5ef7c6da6
// VIP-34: current execution phase and no invented conversion.
// docs/design/vips/0038-effect-lint-built-in.md#5ddef204ae55e32b
// VIP-38: current execution phase and no invented conversion.
// docs/design/vips/0038-effect-lint-built-in.md#628b178179fe4d27
// VIP-38: current execution phase and no invented conversion.
// docs/design/vips/0038-effect-lint-built-in.md#4662e298d858f61b
// VIP-38: current execution phase and no invented conversion.
// run-seconds: 180
import assert from "node:assert/strict"
import {compareTwin,exitView} from "../_cov-tooling-twin.mjs"
import {checkRunPhase} from "../_cov-tooling-run-phase.mjs"
await compareTwin(import.meta.url,"main",[null],async(fn,E)=>{const outer=await E.runPromiseExit(fn());assert.equal(outer._tag,"Success");assert.equal(outer.value,7);return exitView(outer)})
checkRunPhase(false)
console.log("compiler-and-tooling-run-phase")
