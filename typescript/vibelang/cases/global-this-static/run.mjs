import assert from "node:assert/strict"
import { checks } from "./out/main.js"
assert.deepEqual(checks, Array(7).fill(true))
console.log(JSON.stringify(checks))
