import assert from "node:assert/strict"
import * as actual from "./out/main.js"
import { marker as actualMarker } from "./out/foreign.js"
import * as reference from "./typescript/out/main.js"
import { marker as referenceMarker } from "./typescript/out/foreign.js"

async function observe(factory, kind, marker) {
  let returned = false
  let same = false
  let value
  try { value = factory(kind); returned = value instanceof Promise } catch {}
  try { await value } catch (reason) { same = reason === marker }
  return [returned, same]
}
for (const name of ["literal", "foreign"]) {
  for (let kind = 0; kind < 8; kind++) {
    const a = await observe(actual[name], kind, actualMarker)
    const b = await observe(reference[name], kind, referenceMarker)
    assert.deepEqual(a, [true, true], name + "/" + kind)
    assert.deepEqual(a, b, name + "/" + kind + " native counterpart")
  }
}
console.log("Promise executor references: 16 native rejection contracts preserved")
