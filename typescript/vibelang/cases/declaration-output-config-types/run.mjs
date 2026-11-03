// run-seconds: 240
import { nativeContract } from "../_cov-tooling-declarations.mjs"
nativeContract("sidecar-config")
console.log("sidecarDir is a path string rather than a switch, nullable alias, array or CLI flag")
