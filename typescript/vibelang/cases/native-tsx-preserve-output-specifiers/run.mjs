import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
assert.ok(existsSync(new URL("./out/token.jsx", import.meta.url)))
for (const file of ["main.js"]) {
  const text = readFileSync(new URL("./out/" + file, import.meta.url), "utf8")
  assert.equal(text.split('"./token.jsx"').length - 1, 3, file + " must name the native output in imports, reexports and dynamic imports")
  assert.ok(!text.includes('"./token.js"'), file + " must not name a missing output")
}
console.log("ok")
