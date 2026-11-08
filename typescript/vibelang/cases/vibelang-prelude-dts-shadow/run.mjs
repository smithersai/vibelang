// run-seconds: 120
// Compiles consumer/src/main.ts against out/main.d.ts with this compiler,
// then runs what it exports.
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"

const tsc = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const consumer = fileURLToPath(new URL("./consumer", import.meta.url))
execFileSync(tsc, ["-p", consumer, "--pretty", "false"], { stdio: "inherit" })
const { greeting, missing, nobody } = await import("./consumer/out/main.js")
console.log(await Effect.runPromise(greeting))
console.log((await Effect.runPromise(missing))._tag)
console.log(await Effect.runPromise(nobody))
