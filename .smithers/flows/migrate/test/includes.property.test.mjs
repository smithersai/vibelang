import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const contract = readFileSync(new URL("../README.md", import.meta.url), "utf8")

import { addVibeIncludes } from "../lib/wire.mjs"
const ts = require("typescript")
const segment = fc.stringMatching(/^[a-z][a-z0-9_-]{0,8}$/)
const nativeSuffix = new Map([[".ts", ".vibe"], [".mts", ".vibe"], [".tsx", ".vibex"]])
function expanded(patterns) {
  const expected = [...patterns]
  for (const pattern of patterns) {
    const suffix = pattern.slice(pattern.lastIndexOf("."))
    if (!nativeSuffix.has(suffix) || pattern.endsWith(".d" + suffix)) continue
    const native = pattern.slice(0, -suffix.length) + nativeSuffix.get(suffix)
    if (!expected.includes(native)) expected.push(native)
  }
  return expected
}
function check(input) {
  const before = { compilerOptions: { composite: true }, include: input.patterns, exclude: ["node_modules", "vendor", ...(input.excludes ?? [])], references: [{ path: "../shared" }] }
  const text = JSON.stringify(before, null, input.multiline ? 2 : undefined)
  const result = addVibeIncludes(text, ts)
  const after = JSON.parse(result)
  assert.deepEqual(after, { ...before, include: expanded(before.include), exclude: expanded(before.exclude) })
  assert.equal(addVibeIncludes(result, ts), result)
}
test("alchemy: composite include neighbours preserve original patterns and exclude declaration patterns", () => {
  assert.ok(contract.includes("`.vibex` counterparts for `.tsx` selectors"))
  assert.ok(contract.includes("selectors in both `include` and `exclude`"))
  const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-composite-includes.json", import.meta.url), "utf8"))
  check(corpus.input)
  const root = fc.array(segment, { minLength: 1, maxLength: 3 }).map((parts) => parts.join("/"))
  const pattern = fc.tuple(root, fc.constantFrom("**/*.ts", "**/*.mts", "**/*.tsx", "*.d.ts", "*.d.mts", "*.d.tsx", "*.js", "**/*", "**/*.vibe", "**/*.vibex")).map(([root, ending]) => root + "/" + ending)
  fc.assert(fc.property(fc.record({ patterns: fc.array(pattern, { minLength: 0, maxLength: 10 }), excludes: fc.array(pattern, { minLength: 0, maxLength: 10 }), multiline: fc.boolean() }), check), { seed: 63076307, numRuns: 300 })
})
