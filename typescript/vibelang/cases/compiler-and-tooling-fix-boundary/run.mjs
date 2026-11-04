// run-seconds: 240
import { checkFixScope } from "../_cov-tooling-fix-scope.mjs"
checkFixScope("boundary")
console.log("external and dependency configs and sources stay intact")
