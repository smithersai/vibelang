import assert from "node:assert/strict"
import { Effect } from "effect"
import { main } from "./out/main.js"
import { main as twin } from "./out/reference.js"
const a = await Effect.runPromiseExit(main())
const b = await Effect.runPromiseExit(twin())
assert.deepEqual(a, b)
assert.equal(a._tag, "Success")
assert.deepEqual(a.value, [true, true, true, 0, 7, 1, true, true, true, true, true, true, 0])
console.log("same Exit")
