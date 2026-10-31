import assert from "node:assert/strict"
import { Effect } from "effect"
import { main } from "./out/main.js"
import { main as reference } from "./out/reference.js"

const actual = Effect.runSyncExit(main())
const expected = Effect.runSyncExit(reference())
assert.deepEqual(actual, expected)
assert.deepEqual(actual.value, [true, true])
console.log("is expressions preserve statement parsing")
