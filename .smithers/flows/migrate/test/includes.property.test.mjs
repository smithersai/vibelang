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
function check(input) {
  const before = { compilerOptions: { composite: true }, include: input.patterns, exclude: ["node_modules", "vendor"], references: [{ path: "../shared" }] }
  const text = JSON.stringify(before, null, input.multiline ? 2 : undefined)
  const result = addVibeIncludes(text, ts)
  const after = JSON.parse(result)
  const expected = [...input.patterns]
  for (const pattern of input.patterns) {
    if (!/\.tsx?$/.test(pattern) || /\.d\.tsx?$/.test(pattern)) continue
    const vibe = pattern.replace(/\.tsx?$/, ".vibe")
    if (!expected.includes(vibe)) expected.push(vibe)
  }
  assert.deepEqual(after, { ...before, include: expected })
  assert.equal(addVibeIncludes(result, ts), result)
}
test("alchemy: composite include neighbours preserve original patterns and exclude declaration patterns", () => {
  assert.ok(contract.includes("include pattern beside each"))
  const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-composite-includes.json", import.meta.url), "utf8"))
  check(corpus.input)
  const root = fc.array(segment, { minLength: 1, maxLength: 3 }).map((parts) => parts.join("/"))
  const pattern = fc.tuple(root, fc.constantFrom("**/*.ts", "**/*.tsx", "*.d.ts", "*.js", "**/*", "**/*.vibe")).map(([root, ending]) => root + "/" + ending)
  fc.assert(fc.property(fc.record({ patterns: fc.array(pattern, { minLength: 0, maxLength: 10 }), multiline: fc.boolean() }), check), { seed: 63076307, numRuns: 300 })
})
