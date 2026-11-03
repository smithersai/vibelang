import assert from "node:assert/strict"
import { Effect, Exit } from "effect"
import * as actual from "./out/main.js"
import * as reference from "./typescript/out/main.js"
const a = await Effect.runPromiseExit(actual.main())
const b = await Effect.runPromiseExit(reference.main())
assert.deepEqual(a, b)
assert.ok(Exit.isSuccess(a))
assert.deepEqual(a.value, 7)
console.log(JSON.stringify(a.value))
