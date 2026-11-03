// run-seconds: 180
import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as native from "./out/native.js"
assert.deepEqual(actual.namespaces,native.namespaces)
assert.deepEqual(actual.functions,native.functions)
assert.equal(actual.namespaces.length,143)
assert.equal(actual.functions.length,6)
console.log("coverage-ok")
