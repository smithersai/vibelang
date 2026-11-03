// run-seconds: 180
import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as native from "./out/native.js"
assert.deepEqual(actual.value,native.value)
assert.deepEqual(actual.hasKey,native.hasKey)
assert.deepEqual(actual.value,15)
assert.deepEqual(actual.hasKey,true)
console.log("coverage-ok")
