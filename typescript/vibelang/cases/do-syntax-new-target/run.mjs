import assert from "node:assert/strict"
import { probe } from "./out/main.js"
import { probe as native } from "./out/native.js"
const actual = probe()
assert.deepEqual(actual, native())
console.log(JSON.stringify(actual))
