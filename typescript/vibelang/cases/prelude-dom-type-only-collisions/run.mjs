import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
const tsc = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
execFileSync(tsc, ["-p", fileURLToPath(new URL("./consumer", import.meta.url)), "--pretty", "false"], { stdio: "inherit" })
const { result } = await import("./consumer/out/main.js")
console.log(JSON.stringify(result))
