import assert from "node:assert/strict"
import { probe } from "./out/main.js"
import { probe as native } from "./out/native.js"
const actual = probe()
assert.deepEqual(actual, native())
assert.deepEqual(actual[1].slice(0, 5), ["rhs", "set:7", "key", "rhs2", "set:8"])
// Engines differ on the base selected after prototype mutation. The complete
// comparison above requires the same behavior as this engine's native IIFE.
console.log("native super assignment matched")
