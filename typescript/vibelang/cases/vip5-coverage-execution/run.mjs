import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as reference from "./typescript/out/main.js"
assert.equal(Effect.runSync(actual.completed()), 7)
assert.equal(Effect.runSync(reference.completed()), 7)
const expected = [0,3,true,true,true,3,3,3,true,3,true,9,4]
const a = Effect.runSyncExit(actual.main())
const b = Effect.runSyncExit(reference.main())
assert.deepEqual(a, b, "VibeLang and Effect TypeScript Exit must agree")
assert.equal(a._tag, "Success")
assert.deepEqual(a.value, expected)
console.log("execution parity: 13 observations and synchronous completion")
