import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
const js = readFileSync(new URL("./out/main.js", import.meta.url), "utf8")
assert.ok(!js.includes("helper") && !js.includes("other"), js)
const { f } = await import("./out/main.js")
console.log("f(2) = " + f(2))
console.log("imports: " + js.split("\n").filter((line) => line.startsWith("import ")).join(" | "))
