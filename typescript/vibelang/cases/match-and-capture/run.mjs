import assert from "node:assert/strict"
import { identity, left, nested, control } from "./out/main.js"
for (const state of [{ _tag: "Idle" }, { _tag: "Ready", value: 42 }]) {
  for (const f of [identity, left, nested, control]) assert.equal(f(state), state)
}
console.log("capture identity preserved")
