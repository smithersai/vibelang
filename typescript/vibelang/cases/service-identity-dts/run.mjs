// run-seconds: 120
// Compiles consumer/ against out/main.d.ts with this compiler, then runs what
// it exports.
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"

const tsc = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const consumer = fileURLToPath(new URL("./consumer", import.meta.url))
execFileSync(tsc, ["-p", consumer, "--pretty", "false"], { stdio: "inherit" })
const { fake, literal, live, memory } = await import("./consumer/out/main.js")
const { viaVibe } = await import("./consumer/out/use.js")
for (const program of [fake, literal, live, memory, viaVibe()]) console.log(await Effect.runPromise(program))
