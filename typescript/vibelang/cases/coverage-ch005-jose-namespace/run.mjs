import assert from "node:assert/strict"
import * as actual from "./out/main.js"
import * as native from "./out/native.js"
assert.equal(actual.namespace,native.namespace)
console.log("coverage-ok")
