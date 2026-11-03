// run-seconds: 180
import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as native from "./out/native.js"
assert.deepEqual(actual.values,native.values)
assert.deepEqual(actual.shadow,native.shadow)
assert.deepEqual(actual.shadow,["local", 7])
console.log("coverage-ok")
