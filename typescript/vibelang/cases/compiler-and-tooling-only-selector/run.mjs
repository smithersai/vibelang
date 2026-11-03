// run-seconds: 240
import { nativeContract } from "../_cov-tooling-native.mjs"
nativeContract("only-option")
console.log("compiler fix interface has no migration-driver --only selector")
