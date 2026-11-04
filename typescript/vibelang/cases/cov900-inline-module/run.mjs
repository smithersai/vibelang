import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { compareTwin } from "../../test/cov900-twin.mjs"

await compareTwin(fileURLToPath(new URL(".", import.meta.url)), "module")
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const vibe = await import("./out/main.js")
const twin = await import("./effect-ts/out/main.js")
// docs/design/vips/0040-module-declarations.md: moving a body to a sibling TypeScript file changes no run-time observation.
await fc.assert(fc.asyncProperty(fc.oneof(fc.string({ maxLength: 100 }), fc.constantFrom("", "\t résumé　\n", "\u00a0")), async value => {
  const actual = await Effect.runPromiseExit(vibe.normalized(value))
  const expected = await Effect.runPromiseExit(twin.normalized(value))
  assert.deepEqual(actual, expected)
  assert.equal(actual.value, value.trim())
}), { seed: 9000040, numRuns: 64 })
