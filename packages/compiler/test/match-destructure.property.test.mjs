import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { fc, migrationPair, skip } from "./migration-helpers.mjs"
const source = readFileSync(new URL("./corpus/foldkit-match-default-destructure.txt", import.meta.url), "utf8")

test("foldkit-49: destructured fallbacks preserve defaults, getter reads and inherited/callable subjects", { skip, timeout: 120000 }, async t => {
  const { original, changed, text } = await migrationPair(t, source, "EK4839")
  assert.doesNotMatch(text, /Match\.orElse/)
  const result = (f, tag, selected, fallback, inherited, callable) => {
    const trace = []
    const fields = {
      _tag: { enumerable: true, get() { trace.push("tag"); return tag } },
      value: { enumerable: true, get() { trace.push("value"); return selected } },
      extra: { enumerable: true, get() { trace.push("extra"); return 7 } }
    }
    const base = callable ? function input() {} : {}
    const input = inherited ? Object.create(Object.defineProperties(base, fields)) : Object.defineProperties(base, fields)
    return { output: f(input, trace, fallback), trace }
  }
  fc.assert(fc.property(fc.constantFrom("A", "B"), fc.option(fc.integer(), { nil: undefined }), fc.integer(), fc.boolean(), fc.boolean(), (tag, selected, fallback, inherited, callable) => {
    assert.deepEqual(result(changed.choose, tag, selected, fallback, inherited, callable), result(original.choose, tag, selected, fallback, inherited, callable))
  }), { seed: 4933149, numRuns: 250 })
})
