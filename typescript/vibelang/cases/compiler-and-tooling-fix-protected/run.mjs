// run-seconds: 240
import { checkFixScope } from "../_cov-tooling-fix-scope.mjs"
checkFixScope("protected")
console.log("selected native files, declarations, dependencies and output stay intact")
