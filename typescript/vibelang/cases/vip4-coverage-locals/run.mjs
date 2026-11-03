import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as reference from "./typescript/out/main.js"
const a = await Effect.runPromiseExit(actual.main()), b = await Effect.runPromiseExit(reference.main())
assert.deepEqual(a,b)
assert.equal(a._tag,"Success")
assert.deepEqual(a.value,[2, 3, 4, 5])
console.log("native parity: vip4-coverage-locals")
