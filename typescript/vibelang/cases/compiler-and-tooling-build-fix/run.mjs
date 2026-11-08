// run-seconds: 300
import {nativeContract} from "../_cov-tooling-declarations.mjs"
nativeContract("build-fix")
console.log("build mode fixes each project in dependency order")
