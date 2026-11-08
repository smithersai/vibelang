// run-seconds: 120
// Runs each entry module as its host starts it: Node for the node import,
// Bun for the bun import.
import { execFileSync } from "node:child_process"

for (const [host, entry] of [[process.execPath, "out/node-crypto.js"], [process.execPath, "out/node-fs.js"], [process.execPath, "out/node-mixed.js"], ["bun", "out/bun-crypto.js"], ["bun", "out/bun-fs.js"]]) {
  process.stdout.write(execFileSync(host, [entry], { encoding: "utf8" }))
}
