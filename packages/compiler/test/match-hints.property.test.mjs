import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { fc, migrationPair, skip } from "./migration-helpers.mjs"
const source = readFileSync(new URL("./corpus/foldkit-hoisted-match-return-type.txt", import.meta.url), "utf8")

test("foldkit-56: immutable hoisted hints preserve result contracts and eager subject order", { skip, timeout: 120000 }, async t => {
  const { original, changed, text } = await migrationPair(t, source, "EK4839")
  assert.doesNotMatch(text, /Match\.(?:value|type|when|orElse)\b/)
  fc.assert(fc.property(fc.integer(), value => {
    for (const name of ["choose", "another"]) {
      const run = f => { const trace = []; return { output: f(value, trace), trace } }
      assert.deepEqual(run(changed[name]), run(original[name]))
    }
    assert.equal(changed.describe(value), original.describe(value))
  }), { seed: 5633156, numRuns: 250 })
})
