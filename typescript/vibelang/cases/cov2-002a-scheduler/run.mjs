import assert from "node:assert/strict"
import { Effect } from "effect"
import { main } from "./out/main.js"
import { main as twin } from "./out/reference.js"
const a = await Effect.runPromiseExit(main())
const b = await Effect.runPromiseExit(twin())
assert.deepEqual(a, b)
assert.equal(a._tag, "Success")
assert.deepEqual(a.value, [7, ["run", "after"]])
console.log("same Exit")
assert.deepEqual(Effect.runSync(main()),[7,["run","after"]])
assert.deepEqual(Effect.runSync(twin()),[7,["run","after"]])
