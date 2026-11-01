import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { fc, migrationPair, skip } from "./migration-helpers.mjs"
const source = readFileSync(new URL("./corpus/foldkit-option-match-native.txt", import.meta.url), "utf8")

test("foldkit-38: native Option choice preserves callback getters, early returns and destructuring", { skip, timeout: 120000 }, async t => {
  const { original, changed, text, Option } = await migrationPair(t, source, "EK4839")
  assert.doesNotMatch(text, /Option\.match/)
  assert.match(text, /when Option\.Some\(let /)
  const result = (f, value, bias, object) => {
    const trace = []
    const raw = value === null ? Object.create(Option.none()) : Option.some(object ? { n: value } : value)
    Object.defineProperty(raw, "_tag", { get() { trace.push("tag"); return value === null ? "None" : "Some" } })
    if (value !== null) Object.defineProperty(raw, "value", { get() { trace.push("value"); return object ? { n: value } : value } })
    const output = f(raw, trace, bias)
    return { output, trace }
  }
  fc.assert(fc.property(fc.option(fc.integer(), { nil: null }), fc.integer(), (value, bias) => {
    assert.deepEqual(result(changed.choose, value, bias, false), result(original.choose, value, bias, false))
    assert.deepEqual(result(changed.destructure, value, bias, true), result(original.destructure, value, bias, true))
    assert.deepEqual(result(changed.destructure, undefined, bias, true), result(original.destructure, undefined, bias, true))
    assert.deepEqual(result(changed.alias, value, bias, false), result(original.alias, value, bias, false))
  }), { seed: 3833138, numRuns: 250 })
})
