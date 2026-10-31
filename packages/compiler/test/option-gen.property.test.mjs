import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { fc, migrationPair, skip } from "./migration-helpers.mjs"
const source = readFileSync(new URL("./corpus/foldkit-option-gen-pure.txt", import.meta.url), "utf8")

test("foldkit-36: flow fixes eager Option generators and preserves results, identity and ordered reads", { skip, timeout: 120000 }, async t => {
  const { original, changed, text, Option } = await migrationPair(t, source, "EK1002")
  assert.doesNotMatch(text, /Option\.gen|yield\*/)
  const result = (f, values, n) => {
    const trace = []
    const options = values.map((v, i) => v === null ? Option.none() : Object.defineProperty(Option.some(v), "value", { get() { trace.push("value:" + i); return v } }))
    const output = f(options, trace, n)
    return { tag: output._tag, value: Option.isSome(output) ? output.value : null, trace, reused: options.includes(output) }
  }
  fc.assert(fc.property(fc.array(fc.option(fc.integer({ min: -1000, max: 1000 }), { nil: null }), { minLength: 4, maxLength: 4 }), fc.integer({ min: 0, max: 4 }), (values, n) => {
    for (const name of ["sum", "loop", "discard", "early", "capture"]) {
      assert.deepEqual(result(changed[name], values, n), result(original[name], values, n), name)
    }
  }), { seed: 3633174, numRuns: 250 })
})
