import assert from "node:assert/strict"
import { same, contextual } from "./out/main.js"
assert.equal(same, true)
assert.equal(contextual, 17)
console.log(JSON.stringify([same, contextual]))
