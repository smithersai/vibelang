import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { fc, migrationPair, skip } from "./migration-helpers.mjs"
let source = readFileSync(new URL("./corpus/foldkit-match-string-prefix.txt", import.meta.url), "utf8")

const prefixIndex = source.indexOf('EffectString.startsWith("Core")', source.indexOf("export function hygiene"))
const binding = "$matchString" + Buffer.byteLength(source.slice(0, prefixIndex), "utf8")
source = source.replaceAll("bindingForPrefix", binding)

test("foldkit-53: string guards preserve prefix choice order, Unicode and nested property reads", { skip, timeout: 120000 }, async t => {
  const { original, changed, text } = await migrationPair(t, source, "EK4839")
  assert.doesNotMatch(text, /Match\.when/)
  const check = value => {
    assert.equal(changed.weight(value), original.weight(value))
    assert.equal(changed.unicodeWeight(value), original.unicodeWeight(value))
    assert.equal(changed.hygiene(value), original.hygiene(value))
    const run = f => {
      let reads = 0
      const input = { get name() { reads++; return value } }
      return { output: f(input), reads }
    }
    assert.deepEqual(run(changed.nested), run(original.nested))
  }
  for (const value of ["", "Core", "Codec", "Data", "Exact", "core", "Co", "CoreCodec", "\u0000", "💫", "\ud800"]) check(value)
  fc.assert(fc.property(fc.tuple(fc.constantFrom("", "Core", "Codec", "Data", "Exact", "Other"), fc.string()).map(([a,b]) => a+b), check), { seed: 5333153, numRuns: 300 })
})
