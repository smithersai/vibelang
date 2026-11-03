// run-seconds: 180
import {nativeContract} from "../_cov-tooling-declarations.mjs"
nativeContract("foreign-defaults")
console.log("unannotated foreign calls stay ordinary and never contracts stay nonthrowing")
