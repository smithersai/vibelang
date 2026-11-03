// run-seconds: 180
import {nativeContract} from "../_cov-tooling-declarations.mjs"
nativeContract("matcher-declarations")
console.log("error and schema error declarations retain runtime references and static matchers")
