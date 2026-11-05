import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { Effect } from "effect"
import { caught, main } from "./out/main.js"
import { nativeCaught } from "./out/foreign.js"
const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const fc = require("fast-check")

// Chapter 004: a catch parameter needs an explicit block or arm for its is binding.
fc.assert(fc.property(
  fc.integer(),
  fc.option(fc.jsonValue(), { nil: undefined }),
  fc.boolean(),
  (n, code, present) => {
    const value = present ? { code } : {}
    assert.deepEqual(caught(value, n), nativeCaught(value, n))
    assert.deepEqual(caught(value, n), !present || code === undefined ? [n, true] : [code])
  }
), { numRuns: 256, seed: 705, examples: [[1, undefined, false], [2, undefined, true], [3, false, true], [4, null, true]] })
console.log("@@result " + JSON.stringify(Effect.runSync(main())))
