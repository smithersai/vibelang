import { readFileSync } from "node:fs"
import { v4, v6 } from "./out/main.js"

console.log("isIPv6:", v6, v4)
for (const line of readFileSync("out/main.js", "utf8").split("\n")) if (line.startsWith("import ")) console.log(line)
