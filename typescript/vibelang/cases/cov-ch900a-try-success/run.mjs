import assert from "node:assert/strict"
import { Effect } from "effect"
import * as V from "./out/main.js"
import * as T from "./typescript/out/main.js"
const v = await Effect.runPromiseExit(V.main())
const t = await Effect.runPromiseExit(T.main())
assert.deepEqual(v, t, "Effect translation must preserve Exit")
assert.equal(v._tag, "Success")
assert.deepEqual(v.value, 1)
console.log("ok")
