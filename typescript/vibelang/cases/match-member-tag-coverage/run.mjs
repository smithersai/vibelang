import assert from "node:assert/strict"
import { main } from "./out/main.js"
import { main as twin } from "./typescript/out/main.js"
assert.deepEqual(main(), twin())
console.log(JSON.stringify(main()))
