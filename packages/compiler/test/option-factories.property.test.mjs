import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { fc, migrationPair, skip } from "./migration-helpers.mjs"
const source = readFileSync(new URL("./corpus/foldkit-option-map-factory.txt", import.meta.url), "utf8")

test("foldkit-39: pipe arguments and callback factories run before any Option stage", { skip, timeout: 120000 }, async t => {
  const { original, changed, text, Option } = await migrationPair(t, source, "EK4840")
  assert.doesNotMatch(text, /Option\.map\(/)
  const result = (f, value, delta) => {
    const trace = []
    const output = f(value === null ? Option.none() : Option.some(value), trace, delta)
    return { tag: output._tag, value: Option.isSome(output) ? output.value : null, trace }
  }
  fc.assert(fc.property(fc.option(fc.integer({min:-100000,max:100000}), { nil: null }), fc.integer({min:-100000,max:100000}), (value, delta) => {
    for (const name of ["choose", "methods", "getter"]) assert.deepEqual(result(changed[name], value, delta), result(original[name], value, delta), name)
    const runArray = f => {
      const trace = []
      const input = value === null ? Option.none() : Option.some([value])
      const output = f(input, trace, delta)
      return { tag:output._tag, value:Option.isSome(output) ? output.value : null, trace, reused:output === input }
    }
    assert.deepEqual(runArray(changed.append), runArray(original.append))
  }), { seed: 3933139, numRuns: 250 })
})
