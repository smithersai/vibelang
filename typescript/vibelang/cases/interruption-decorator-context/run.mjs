import assert from "node:assert/strict"
import { Effect } from "effect"
import { main } from "./out/main.js"

const expected = ["class", "method", "field", "getter", "setter"]
const actual = Effect.runSync(main())
assert.deepEqual(actual, expected)
console.log("ok")
