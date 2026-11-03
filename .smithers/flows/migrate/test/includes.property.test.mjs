import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
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
  // The stock TypeScript parser, not the rewrite's text, proves membership.
  const root = mkdtempSync(join(tmpdir(), "composite-selectors-"))
  try {
    const twins = new Map()
    for (const pattern of input.patterns) {
      const prefix = pattern.slice(0, pattern.indexOf("*") < 0 ? pattern.lastIndexOf("/") + 1 : pattern.indexOf("*")).replace(/\/$/, "")
      const directory = join(root, prefix)
      mkdirSync(directory, { recursive: true })
      for (const [name, twin] of [["Plain.ts", "Plain.vibe"], ["View.tsx", "View.vibex"], ["Story.stories.tsx", "Story.stories.vibex"], ["Mixed.mts", "Mixed.vibe"], ["Native.d.ts", null], ["Native.d.mts", null], ["Existing.vibe", null]]) {
        const file = join(directory, name)
        writeFileSync(file, "export const n = 1\n")
        if (twin) {
          const target = join(directory, twin)
          writeFileSync(target, "export const n = 1\n")
          twins.set(file, target)
        }
      }
    }
    const extensions = [".vibe", ".vibex"].map(extension => ({ extension, isMixedContent: false, scriptKind: ts.ScriptKind.Deferred }))
    const members = config => ts.parseJsonConfigFileContent(config, ts.sys, root, undefined, undefined, undefined, extensions).fileNames
    const native = members(before), expectedMembers = new Set(native.filter(file => !file.endsWith(".vibe") && !file.endsWith(".vibex")))
    const actual = members(after).sort()
    // A .vibe path can stand for either native .ts or .mts; an existing
    // .vibe file is eligible too. Ask stock TypeScript about each possible
    // native twin without letting those counterfactual files enter "actual".
    const candidates = new Map()
    const converted = new Set([...twins.values()])
    for (const file of native) if (file.endsWith(".vibe") || file.endsWith(".vibex")) converted.add(file)
    for (const pattern of input.patterns) {
      const prefix = pattern.slice(0, pattern.indexOf("*") < 0 ? pattern.lastIndexOf("/") + 1 : pattern.indexOf("*")).replace(/\/$/, "")
      converted.add(join(root, prefix, "Existing.vibe"))
    }
    for (const file of converted) {
      const alternatives = file.endsWith(".vibex") ? [file.slice(0, -6) + ".tsx"] : [file.slice(0, -5) + ".ts", file.slice(0, -5) + ".mts"]
      candidates.set(file, alternatives)
      for (const alias of alternatives) if (!existsSync(alias)) writeFileSync(alias, "export const n = 1\n")
    }
    const included = new Set(members({ ...before, exclude: [] }))
    const excluded = new Set(members({ ...before, include: before.exclude, exclude: [] }))
    for (const [file, alternatives] of candidates) {
      const eligible = included.has(file) || alternatives.some(alias => included.has(alias))
      const denied = excluded.has(file) || alternatives.some(alias => excluded.has(alias))
      if (eligible && !denied) expectedMembers.add(file)
    }
    assert.deepEqual(actual, [...expectedMembers].sort())
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("alchemy: composite include neighbours preserve original patterns and exclude declaration patterns", () => {
  assert.ok(contract.includes("`.vibex` counterparts for `.tsx` selectors"))
  assert.ok(contract.includes("selectors in both `include` and `exclude`"))
  const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-composite-includes.json", import.meta.url), "utf8"))
  check(corpus.input)
  const opencode = JSON.parse(readFileSync(new URL("./corpus/opencode-jsx-selector-oracle.json", import.meta.url), "utf8"))
  check(opencode.input)
  const root = fc.array(segment, { minLength: 1, maxLength: 3 }).map((parts) => parts.join("/"))
  const pattern = fc.tuple(root, fc.constantFrom("**/*.ts", "**/*.mts", "**/*.tsx", "*.d.ts", "*.d.mts", "*.d.tsx", "*.js", "**/*", "**/*.vibe", "**/*.vibex")).map(([root, ending]) => root + "/" + ending)
  fc.assert(fc.property(fc.record({ patterns: fc.array(pattern, { minLength: 0, maxLength: 10 }), excludes: fc.array(pattern, { minLength: 0, maxLength: 10 }), multiline: fc.boolean() }), check), { seed: 63076307, numRuns: 300 })
})
