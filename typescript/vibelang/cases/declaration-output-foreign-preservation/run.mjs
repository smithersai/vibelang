// run-seconds: 240
import { checkContracts } from "../_cov-tooling-contracts.mjs"
checkContracts("foreign")
console.log("foreign callable contracts survive aliases, reexports, overloads and declarations")
