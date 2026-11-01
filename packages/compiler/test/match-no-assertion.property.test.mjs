import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { fc, migrationPair, skip } from "./migration-helpers.mjs"
const source = readFileSync(new URL("./corpus/foldkit-match-return-type-no-assertion.txt", import.meta.url), "utf8")

test("foldkit-85/86: Match result hints become checked annotations without type assertions", {skip,timeout:120000}, async t => {
  const {original,changed,text} = await migrationPair(t,source,"EK4839")
  assert.doesNotMatch(text,/\bas\s+View\b/,"the repository rejects type assertions")
  assert.doesNotMatch(text,/Match\.value/)
  assert.match(text,/const \{ model, commands \}: View = match/)
  fc.assert(fc.property(fc.constantFrom("Valid","Invalid"), fc.integer({min:-1000000,max:1000000}), (value,input) => {
    for (const name of ["typed","arrow","destructured"]) {
      const run = f => { const trace=[];return {result:f(value,trace,input),trace} }
      assert.deepEqual(run(changed[name]),run(original[name]))
    }
    assert.deepEqual(changed.hygiene(value,input),original.hygiene(value,input))
  }),{seed:850086,numRuns:250})
})
