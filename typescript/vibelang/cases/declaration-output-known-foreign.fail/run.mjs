// run-seconds: 180
import {nativeContract} from "../_cov-tooling-declarations.mjs"
nativeContract("foreign-gate")
console.log("explicit foreign unknown and any contracts reject unwrapped plain calls")
