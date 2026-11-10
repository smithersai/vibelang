import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
const here = dirname(fileURLToPath(import.meta.url))
const main = await import("./out/main.js")
console.log("exports: " + Object.keys(main).sort().join(", "))
console.log("quadruple(3) = " + main.quadruple(3))
console.log("sumBelow(5) = " + main.sumBelow(5))
const js = readFileSync(join(here, "out/main.js"), "utf8")
const dts = readFileSync(join(here, "out/main.d.ts"), "utf8")
for (const word of ["double", "proof", "assume", "ensures", "invariant", "decreases", "assert"]) {
  assert.ok(!js.includes(word), "main.js holds " + word)
  assert.ok(!dts.includes(word), "main.d.ts holds " + word)
}
console.log("no spec function or proof statement in main.js or main.d.ts")
