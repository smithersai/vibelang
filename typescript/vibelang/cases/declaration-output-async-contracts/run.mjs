// run-seconds: 180
import {nativeContract} from "../_cov-tooling-declarations.mjs"
nativeContract("async-contracts")
console.log("async declarations preserve throwing callback admission without synchronous rethrows")
