import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as reference from "./typescript/out/main.js"
assert.deepEqual(Effect.runSyncExit(actual.main()),Effect.runSyncExit(reference.main()))
assert.deepEqual(Effect.runSync(actual.main()),[7,true,9,true])
console.log("historical value, named, block and async handlers")
