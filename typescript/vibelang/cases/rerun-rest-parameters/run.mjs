import assert from "node:assert/strict"
import * as actual from "./out/main.js"
import * as native from "./out/native.js"
import { observe } from "./probe.mjs"
const reference = observe(native)
const result = observe(actual)
assert.deepEqual(result, reference)
for (const line of result) console.log(line)
