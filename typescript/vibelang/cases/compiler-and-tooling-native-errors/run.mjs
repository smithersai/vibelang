// docs/design/vips/0027-declaration-output.md#75db5aae1b8478c0
// VIP-27: unchanged TypeScript retains native errors and exception syntax.
// run-seconds: 240
import { nativeContract } from "../_cov-tooling-native.mjs"
nativeContract("native-errors")
console.log("native exception syntax remains native and embedded errors retain TS2322")
