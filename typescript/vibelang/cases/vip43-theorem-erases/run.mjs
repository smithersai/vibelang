import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
const here = dirname(fileURLToPath(import.meta.url))
const main = await import("./out/main.js")
console.log("exports: " + Object.keys(main).sort().join(", "))
console.log("clamp(7, 0, 5) = " + main.clamp(7, 0, 5))
console.log("total([1, 2, 3]) = " + main.total([1, 2, 3]))
const js = readFileSync(join(here, "out/main.js"), "utf8")
const dts = readFileSync(join(here, "out/main.d.ts"), "utf8")
for (const word of ["theorem", "clampInRange", "sumNonNegative", "sortedSuffix", "keepsLength", "isSortedFrom", "inRange", "facts", "assume", "assert"]) {
  assert.ok(!js.includes(word), "main.js holds " + word)
  assert.ok(!dts.includes(word), "main.d.ts holds " + word)
}
console.log("no theorem, spec function, proof statement or proof-only import in main.js or main.d.ts")
