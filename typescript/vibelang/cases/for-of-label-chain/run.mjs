import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const stock = resolve(process.env.EFFECT_NODE_MODULES, "typescript/bin/tsc")
execFileSync(process.execPath, [stock, "-p", fileURLToPath(new URL("./reference", import.meta.url)), "--pretty", "false"], { stdio: "inherit" })
const reference = await import("./reference/out/main.js")
const expected = { doubleOuter: 3, doubleInner: 3, single: 3, breakOuter: 1, tripleOuter: 3, tripleMiddle: 3 }
const errors = []
for (const [name, value] of Object.entries(expected)) {
  try {
    assert.equal(reference[name](), value, name + " stock TypeScript")
    const actual = await import("./out/" + name + ".js")
    assert.equal(actual[name](), reference[name](), name + " VibeLang vs stock TypeScript")
  } catch (error) {
    errors.push(name + ": " + error)
  }
}
assert.deepEqual(errors, [])
console.log(JSON.stringify(expected))
