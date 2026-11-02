import assert from "node:assert/strict"
import { Effect, Exit } from "effect"
import { main as vibe } from "./out/main.js"
import { main as native } from "./typescript/out/main.js"

const actual = await Effect.runPromiseExit(vibe())
const expected = await Effect.runPromiseExit(native())
assert(Exit.isSuccess(actual), "VibeLang main must succeed")
assert(Exit.isSuccess(expected), "native TypeScript main must succeed")
assert.deepEqual(actual.value, expected.value)
console.log("@@result " + JSON.stringify(actual.value))
