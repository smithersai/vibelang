import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
const tsc = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
execFileSync(tsc, ["-p", fileURLToPath(new URL("./consumer", import.meta.url)), "--pretty", "false"], { stdio: "inherit" })
const stock = process.env.EFFECT_NODE_MODULES
  ? resolve(process.env.EFFECT_NODE_MODULES, "typescript/bin/tsc")
  : fileURLToPath(new URL("../../../../experiments/node_modules/typescript/bin/tsc", import.meta.url))
execFileSync(process.execPath, [stock, "-p", fileURLToPath(new URL("./consumer", import.meta.url)), "--pretty", "false"], { stdio: "inherit" })
const { result } = await import("./consumer/out/main.js")
console.log(JSON.stringify(result))
