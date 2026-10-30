import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
execFileSync(fileURLToPath(new URL("../../../built/local/tsc", import.meta.url)),
  ["-p", fileURLToPath(new URL("./consumer", import.meta.url)), "--pretty", "false"],
  { stdio: "inherit" })
