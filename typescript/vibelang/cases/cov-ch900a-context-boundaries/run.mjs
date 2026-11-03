import assert from "node:assert/strict"
import { Effect } from "effect"
import * as V from "./out/main.js"
import * as T from "./typescript/out/main.js"
const actual = await Effect.runPromiseExit(V.main())
const expected = await Effect.runPromiseExit(T.main())
assert.deepEqual(actual, expected, "Appendix A source-context translation must preserve Exit")
assert.equal(actual._tag, "Success")
assert.deepEqual(actual.value, [2, 3, 7])
console.log("ok")
