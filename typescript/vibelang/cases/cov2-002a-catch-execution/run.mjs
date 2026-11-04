import assert from "node:assert/strict"
import { Effect } from "effect"
import { main } from "./out/main.js"
import { main as twin } from "./out/reference.js"
const a = await Effect.runPromiseExit(main())
const b = await Effect.runPromiseExit(twin())
assert.deepEqual(a, b)
console.log("same Exit")
assert.equal(a._tag, "Success")
assert.deepEqual(a.value, [0, 0, 7, 1])
