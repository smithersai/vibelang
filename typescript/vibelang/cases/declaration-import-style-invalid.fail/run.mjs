import assert from "node:assert/strict"
import { one } from "./out/main.js"
assert.equal(one, 1)
console.log("retired invalid style is ignored")
