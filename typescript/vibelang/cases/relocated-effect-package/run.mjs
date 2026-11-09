// run-seconds: 120
import { checkRelocatedEffect } from "../../../../packages/compiler/test/helpers/relocated-effect.mjs"
const dependencies = {
  native: process.env.VIBELANG_BINARY,
  modules: process.env.EFFECT_NODE_MODULES,
  runtime: process.env.VIBELANG_RUNTIME,
}
for (const location of ["packages/effect", "packages/71"]) {
  checkRelocatedEffect({ location, subpaths: false, newline: "\n", value: 1 }, dependencies)
}
console.log("ok")
