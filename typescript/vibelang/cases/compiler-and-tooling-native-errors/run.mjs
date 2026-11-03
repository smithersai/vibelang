// run-seconds: 240
import { nativeContract } from "../_cov-tooling-native.mjs"
nativeContract("native-errors")
console.log("native exception syntax remains native and embedded errors retain TS2322")
