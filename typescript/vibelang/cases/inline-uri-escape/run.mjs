import assert from "node:assert/strict"
import { Effect, Exit } from "effect"
import { read } from "./out/main.js"
const result = await Effect.runPromiseExit(read())
assert(Exit.isSuccess(result))
assert.deepEqual(result.value, [1, 2])
console.log(JSON.stringify(result.value))
