import assert from "node:assert/strict"
import { Effect } from "effect"
import { f } from "./out/main.js"
import { f as native } from "./out/native.js"
const actual = await Effect.runPromiseExit(f())
assert.deepEqual(actual, await Effect.runPromiseExit(native()))
assert.equal(actual._tag, "Success")
