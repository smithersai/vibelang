// run-seconds: 180
import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as native from "./out/native.js"
const result=await Effect.runPromiseExit(actual.main())
assert.deepEqual(result,await Effect.runPromiseExit(native.main()))
assert.equal(result._tag,"Success")
assert.deepEqual(result.value,7)
console.log("coverage-ok")
