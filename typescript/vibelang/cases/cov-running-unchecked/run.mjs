import assert from "node:assert/strict"
import { Effect } from "effect"
import { main } from "./out/main.js"
import { main as twin } from "./out/reference.js"
const actual = await Effect.runPromiseExit(main())
const expected = await Effect.runPromiseExit(twin())
assert.deepEqual(actual, expected)
console.log("same Exit")
