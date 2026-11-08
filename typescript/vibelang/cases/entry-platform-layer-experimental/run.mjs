// run-seconds: 120
// Runs each entry module the way `node out/main.js` does. vibelang-runtime
// ships no experimental modules yet, so hooks.mjs resolves them to the stubs
// that tsconfig.json's paths give the compiler.
import { execFileSync } from "node:child_process"

for (const entry of ["out/main.js", "out/effectonly.js", "out/subtype.js"]) {
  process.stdout.write(execFileSync(process.execPath, ["--import", "./hooks.mjs", entry], { encoding: "utf8" }))
}
