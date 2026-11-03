import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as reference from "./typescript/out/main.js"
const a = await Effect.runPromiseExit(actual.main())
const b = await Effect.runPromiseExit(reference.main())
assert.deepEqual(a,b)
assert.equal(a._tag,"Success")
assert.deepEqual(a.value,[true,["body","ensuring","onExit","parent","child"],true,["id"]])
console.log("lifecycle parity: cleanup order, explicit yield and caller-side fork evaluation")
