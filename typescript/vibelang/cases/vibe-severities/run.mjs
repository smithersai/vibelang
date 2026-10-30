import assert from "node:assert/strict"
import { wait } from "./out/main.js"
const value = { unrun: true }
assert.equal(await wait(value), value)
console.log("await preserves the value")
