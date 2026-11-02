import assert from "node:assert/strict"
import { names } from "./out/main.js"
import { names as native } from "./out/native.js"
assert.deepEqual(names(), native())
console.log("names agree")
