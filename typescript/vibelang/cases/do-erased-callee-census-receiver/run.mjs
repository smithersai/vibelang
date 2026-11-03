import assert from "node:assert/strict"
import { probe } from "./out/main.js"
import { probe as native } from "./out/native.js"
assert.equal(native(), 7)
assert.equal(probe(), native())
console.log("RC-39 census witness retains receiver: 7")
