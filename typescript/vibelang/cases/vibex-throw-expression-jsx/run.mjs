import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { Effect } from "effect"
import { main, lookup, Missing, jsxCalls } from "./out/main.js"
const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const fc = require("fast-check")
fc.assert(fc.property(fc.oneof(fc.constant("1"), fc.string()), id => {
  jsxCalls.length = 0
  const program = lookup(id)
  assert.deepEqual(jsxCalls, [], "JSX factory stays cold")
  const expected = id === "1" ? Effect.succeed("Ada") : Effect.fail(new Missing({ id }))
  assert.deepEqual(Effect.runSyncExit(program), Effect.runSyncExit(expected))
  assert.deepEqual(jsxCalls, id === "1" ? [] : [id], "only the selected throw operand runs once")
}), { seed: 41284, numRuns: 100 })
console.log("@@result " + JSON.stringify(await Effect.runPromise(main())))
