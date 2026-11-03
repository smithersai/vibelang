import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { fc, migrationPair, skip } from "./migration-helpers.mjs"
const source = readFileSync(new URL("./corpus/foldkit-option-match-native.txt", import.meta.url), "utf8")

// Chapter 007 / Option choice rewrite preserves getter and callback evaluation: docs/design/src/007-tooling.md#fbe985f7c3963d3b
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

test("foldkit-105: statement, conditional, parenthesized, returned and arrow choices preserve execution", { skip, timeout: 120000 }, async t => {
  const corpus = readFileSync(new URL("./corpus/foldkit-option-match-statements.txt", import.meta.url), "utf8")
  const { original, changed, text, Option } = await migrationPair(t, corpus, "EK4839")
  assert.doesNotMatch(text, /Option\.match/)
  fc.assert(fc.property(fc.option(fc.integer(), { nil: null }), value => {
    for (const key of ["statement", "conditional", "parenthesized", "arrow", "returned", "calledResult", "leftBinary", "leftConditional", "methodResult"]) {
      const v = value === null ? Option.none() : Option.some(value)
      const before = [], after = []
      assert.deepEqual(changed[key](v, after), original[key](v, before))
      assert.deepEqual(after, before)
    }
  }), { seed: 1053838, numRuns: 250 })
})

test("foldkit-105: generated statement nesting and line breaks compile and retain callback effects", { skip, timeout: 120000 }, async t => {
  const shapes = fc.sample(fc.record({
    depth: fc.integer({ min: 0, max: 3 }),
    newline: fc.constantFrom("\n", "\r\n", " "),
    parens: fc.boolean(),
    arrow: fc.boolean(),
  }), { seed: 105105, numRuns: 24 })
  const source = shapes.map((shape, i) => {
    const call = "Option.match(" + shape.newline + "v, { onNone: (): void => { trace.push('none') }, onSome: (n): void => { trace.push(String(n)) } })"
    if (shape.arrow) return "export const f" + i + " = (v: Option.Option<number>, trace: string[]): void =>" + shape.newline + call
    let body = shape.parens ? "(" + call + ");" : call + ";"
    for (let d = 0; d < shape.depth; d++) body = "if (true) {" + shape.newline + body + shape.newline + "}"
    return "export function f" + i + "(v: Option.Option<number>, trace: string[]): void {" + shape.newline + body + shape.newline + "trace.push('after') }"
  }).join("\n")
  const { original, changed, text, Option } = await migrationPair(t, source, "EK4839")
  assert.doesNotMatch(text, /Option\.match/)
  fc.assert(fc.property(fc.option(fc.integer(), { nil: null }), value => {
    const option = value === null ? Option.none() : Option.some(value)
    for (let i = 0; i < shapes.length; i++) {
      const before = [], after = []
      assert.deepEqual(changed["f" + i](option, after), original["f" + i](option, before))
      assert.deepEqual(after, before)
    }
  }), { seed: 1051051, numRuns: 250 })
})
