// The lost-wrapper check over generated functions: an emit identical to the
// original never flags, whatever the shape, and removing the wrapper from any
// one result always flags the function that held it.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"
import { lostWrappers } from "../lib/lost-wrapper.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")

// A result: lost stands where the emit drops this result's wrapper.
const wrapped = i => `Effect.succeed(${i})`
const bare = i => `${i}`
const armsOf = (count, at, lost) => Array.from({ length: count }, (_, i) => i === at && lost ? bare(i) : wrapped(i))
const shapes = {
  concise: (results) => `(n) => ${results.reduceRight((rest, r) => rest === null ? r : `n === ${results.indexOf(r)} ? ${r} : ${rest}`, null)}`,
  block: (results) => `(n) => { ${results.map((r, i) => `if (n === ${i}) return ${r};`).join(" ")} return Effect.never; }`,
}
const holders = {
  variable: (fn) => ({ text: `export const target = ${fn}\n`, name: "/target" }),
  property: (fn) => ({ text: `export const o = { target: ${fn} }\n`, name: "/o/target" }),
  callback: (fn) => ({ text: `export const c = other(1, ${fn})\n`, name: "/c/other(1)" }),
  chained: (fn) => ({ text: `export const c = other(1).pipe(Effect.map(${fn}))\n`, name: "/c/other().pipe(0)/Effect.map(0)" }),
  nested: (fn) => ({ text: `export const outer = () => { const target = ${fn}; return target }\n`, name: "/outer/target" }),
  method: (fn) => ({ text: `export class K { target = ${fn} }\n`, name: "/K/target" }),
}
const prefix = `import * as Effect from "effect/Effect";\n`

const cases = fc.record({
  shape: fc.constantFrom(...Object.keys(shapes)), holder: fc.constantFrom(...Object.keys(holders)),
  count: fc.integer({ min: 1, max: 5 }), at: fc.nat(4), noise: fc.constantFrom("", "first(() => 1);\n", "first(() => Effect.succeed(0));\nother(() => Effect.void);\n"),
}).map(c => ({ ...c, at: c.at % c.count }))
const source = (c, lost) => {
  const held = holders[c.holder](shapes[c.shape](armsOf(c.count, c.at, lost)))
  return { text: prefix + c.noise + held.text, name: held.name }
}

test("an emit identical to its original never flags", () => {
  fc.assert(fc.property(cases, c => {
    const { text } = source(c, false)
    const result = lostWrappers({ ts, original: text, emitted: text })
    assert.deepEqual(result.flags, [])
    assert.deepEqual(result.unpaired, [])
  }), { numRuns: 300 })
})

test("removing one result's wrapper flags that function and nothing else", () => {
  fc.assert(fc.property(cases, c => {
    const original = source(c, false), emitted = source(c, true)
    const result = lostWrappers({ ts, original: original.text, emitted: emitted.text })
    assert.deepEqual(result.flags.map(f => f.function), [original.name])
    assert.equal(result.flags[0].emittedEffectReturns, result.flags[0].effectReturns - 1)
  }), { numRuns: 300 })
})

test("noise inserted before the function in the emit changes nothing", () => {
  fc.assert(fc.property(cases, fc.boolean(), (c, lost) => {
    const original = source(c, false), emitted = source({ ...c, noise: "inserted(() => 0);\n" + c.noise }, lost)
    const result = lostWrappers({ ts, original: original.text, emitted: emitted.text })
    assert.deepEqual(result.flags.map(f => f.function), lost ? [original.name] : [])
  }), { numRuns: 200 })
})

test("every generated generator emit is clean, whatever it returns", () => {
  fc.assert(fc.property(cases, c => {
    const original = source(c, false)
    const fn = `Effect.fnUntraced(function* (n) { return n; })`
    const emitted = prefix + c.noise + holders[c.holder](fn).text
    assert.deepEqual(lostWrappers({ ts, original: original.text, emitted }).flags, [])
  }), { numRuns: 200 })
})
