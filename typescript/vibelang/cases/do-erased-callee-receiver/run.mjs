import assert from "node:assert/strict"
import { probe } from "./out/main.js"
import { probe as native } from "./out/native.js"
const expected = native()
assert.equal(expected.length, 14)
assert.deepEqual(probe(), expected)
console.log("14 erased-callee and native controls passed")
