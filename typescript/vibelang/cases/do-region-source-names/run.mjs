import assert from "node:assert/strict"
import { runPromise } from "effect/Effect"
import { main } from "./out/main.js"
import { main as native } from "./out/native.js"
const actual = await runPromise(main())
const expected = await runPromise(native())
assert.deepEqual(actual, expected, JSON.stringify({ actual, expected }))
console.log("names agree")
