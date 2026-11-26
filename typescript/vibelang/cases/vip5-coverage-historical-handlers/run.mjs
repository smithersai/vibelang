import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as reference from "./typescript/out/main.js"
assert.deepEqual(await Effect.runPromiseExit(actual.main()),await Effect.runPromiseExit(reference.main()))
assert.deepEqual(await Effect.runPromise(actual.main()),[7,true,9,10])
console.log("literal catch handlers match the native Effect results")
