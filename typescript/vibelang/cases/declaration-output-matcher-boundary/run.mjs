// run-seconds: 300
import {nativeContract} from "../_cov-tooling-declarations.mjs"
// rule-evidence: docs/design/vips/0027-declaration-output.md#decision | The published matcher boundary is checked on both declaration outputs.
try {
  nativeContract("matcher-declarations")
} catch (error) {
  throw new Error("Published declarations must omit generated runtime references and static matchers", { cause: error })
}
console.log("error and schema error declarations omit generated runtime references and static matchers")
