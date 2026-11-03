import assert from "node:assert/strict"
import { Effect } from "effect"
import * as f from "./out/main.js"
assert.deepEqual([f.arrow, f.named, f.own, f.kind, f.annotated, f.declaration].map(fn => Effect.runSync(fn())), [true, true, true, "function", true, true])
console.log("self values")
