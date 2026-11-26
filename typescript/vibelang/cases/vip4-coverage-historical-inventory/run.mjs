// rule-evidence: docs/design/vips/0004-throw.md#b776ab2b39524a0c
// VIP-4: VibeLang ships the rethrowing globals: map, forEach, filter, reduce, find,
// rule-evidence: docs/design/vips/0004-throw.md#f31885994e1f643c
// VIP-4: … Any javascript globals like JSON.parse must have no annotation.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
const {entries} = JSON.parse(readFileSync(new URL("../../../../docs/design/inventory/throws.json",import.meta.url),"utf8"))
const find = (module,name) => entries.filter(e=>e.module===module && e.declaration===name)
const promises = find("global", "Promise")
assert.ok(promises.length > 0)
for (const entry of promises) {
  assert.equal(entry.ownThrows, "never")
  assert.deepEqual(entry.rethrows, [])
  assert.ok(entry.callbacks.some(cb => cb.parameter === "executor" && cb.admits === "unknown"))
}
const parses = find("global", "JSON.parse")
assert.ok(parses.length > 0)
assert.ok(parses.every(entry => entry.ownThrows === "SyntaxError" && entry.rethrows.includes("reviver")))
console.log("Promise executor and JSON.parse contracts")
