// run-seconds: 120
// Runs each entry module the way `node out/main.js` does: the host starts it.
import { execFileSync } from "node:child_process"

for (const entry of ["out/main.js", "out/local.js", "out/made.js"]) {
  process.stdout.write(execFileSync(process.execPath, [entry], { encoding: "utf8" }))
}
