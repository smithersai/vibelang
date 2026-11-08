// run-seconds: 120
// Runs main, compiles consumer/src/main.ts against out/main.d.ts with this
// compiler, then runs what it exports.
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { main } from "./out/main.js"

console.log(JSON.stringify(await Effect.runPromise(main())))
const tsc = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const consumer = fileURLToPath(new URL("./consumer", import.meta.url))
execFileSync(tsc, ["-p", consumer, "--pretty", "false"], { stdio: "inherit" })
const { base, program } = await import("./consumer/out/main.js")
console.log(base)
console.log(await Effect.runPromise(program))
