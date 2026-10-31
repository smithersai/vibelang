// Compiles consumer/src/main.ts against out/main.d.ts with this compiler,
// then prints what it exports.
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const tsc = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const consumer = fileURLToPath(new URL("./consumer", import.meta.url))
execFileSync(tsc, ["-p", consumer, "--pretty", "false"], { stdio: "inherit" })
const { lines } = await import("./consumer/out/main.js")
console.log(JSON.stringify(lines))
