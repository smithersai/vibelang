import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as reference from "./typescript/out/main.js"
assert.deepEqual(await Effect.runPromiseExit(actual.main()),await Effect.runPromiseExit(reference.main()))
assert.equal(await Effect.runPromise(actual.main()),5)
console.log("parenthesized join catch executes the joined Effect value")
