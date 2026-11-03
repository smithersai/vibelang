// run-seconds: 240
import { checkContracts } from "../_cov-tooling-contracts.mjs"
checkContracts("local")
console.log("local callable declarations retain their nonthrowing boundary")
