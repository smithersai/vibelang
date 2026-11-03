import assert from "node:assert/strict"
import { Effect } from "effect"
import { g } from "./out/main.js"
import { g as native } from "./out/native.js"
const actual = await Effect.runPromiseExit(g())
assert.deepEqual(actual, await Effect.runPromiseExit(native()))
assert.equal(actual._tag,"Success")
assert.equal(actual.value,null)
