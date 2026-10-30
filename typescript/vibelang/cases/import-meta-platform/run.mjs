import assert from "node:assert/strict"
import { checks } from "./out/main.js"
assert.deepEqual(checks, [true, true, true])
console.log(JSON.stringify(checks))
