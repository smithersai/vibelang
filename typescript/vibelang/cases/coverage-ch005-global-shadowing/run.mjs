import assert from "node:assert/strict"
import * as actual from "./out/main.js"
import * as native from "./out/native.js"
assert.deepEqual(actual.values,native.values)
assert.deepEqual(actual.values,[["local",7],["imported",9]])
console.log("coverage-ok")
