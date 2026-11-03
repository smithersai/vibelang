import assert from "node:assert/strict"
import { probe } from "./out/main.js"
import { reference } from "./out/reference.js"
const expected = Array.from({ length: 11 }, (_, i) => [i < 5, i < 5, i < 5, i < 5])
assert.deepEqual(reference(), expected)
assert.deepEqual(probe(), reference())
console.log("schema error cross-copy matches Effect tag guards")
