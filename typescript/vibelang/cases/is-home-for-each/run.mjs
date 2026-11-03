import assert from "node:assert/strict"
import * as actual from "./out/main.js"
import * as native from "./typescript/out/main.js"
for (const a of [null, undefined, 0, false, "x", {id: 1}]) assert.deepEqual(actual.probe(a), native.probe(a))
for (const name of ["copies", "defaults", "labels", "headWrites"]) assert.deepEqual(actual[name](), native[name](), name)
assert.deepEqual(actual.copies(), [8, 9, 10])
assert.deepEqual(actual.defaults(), [8, 8, 8])
assert.deepEqual(actual.labels(), [8, 10])
assert.deepEqual(actual.headWrites(), [11, 12])
console.log("ok")
