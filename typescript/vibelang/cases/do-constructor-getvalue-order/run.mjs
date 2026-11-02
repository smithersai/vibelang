import assert from "node:assert/strict"
import * as Effect from "effect/Effect"
import { main } from "./out/main.js"
import { runNative } from "./native.ts"

// Node executes the IIFE twin's TypeScript directly, independently of lowering.
const actual = await Effect.runPromise(main())
const native = runNative()
for (const [name, expected] of native) {
  const result = actual.find(([label]) => label === name)
  assert.ok(result, name)
  assert.equal(result[1], true, name + ": compiled IIFE control")
  assert.equal(JSON.stringify(result[2]), JSON.stringify(expected), name + ": native IIFE trace and result")
}
console.log("@@result " + JSON.stringify(actual))
