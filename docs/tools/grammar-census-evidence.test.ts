import { expect, test } from "bun:test"
import fc from "fast-check"
import { changedRules, type Change } from "./rule-evidence"
import { censusSection } from "../../scripts/grammar-census.mjs"
const path = "docs/design/src/001-functions.md"
const appendixPath = "docs/design/src/900-appendices.md"
const censusRow = (n: number) => ({
  hook: "parser/vibelang_census.go:Parser.hook" + n, form: "admission:do",
  authority: "002-running.md", status: "support", reason: "VIP-2: compiler support hook " + n
})
const census = (rows = [censusRow(1)]) => censusSection(rows)
const appendix = (section: string) => "# Appendix A\n\nGrammar production prose.\n\n" + section + "\n\n## Appendix B\n"
const censusChange = (after: string, before = appendix("")): Change => ({ path: appendixPath, before, after })

test("generated grammar census metadata is not a new language rule", () => {
  expect(changedRules([censusChange(appendix(census()))])).toEqual([])
  expect(changedRules([censusChange(appendix(census([censusRow(2)])), appendix(census()))])).toEqual([])
  fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 1000000 }), { minLength: 1, maxLength: 10 }), ns => {
    expect(changedRules([censusChange(appendix(census([...new Set(ns)].map(censusRow))))])).toEqual([])
  }), { numRuns: 50 })
})

test("generated grammar census keeps real adjacent rules and original line numbers", () => {
  const rule = "An `effect` function must return an Effect."
  const after = appendix(census()) + "\n" + rule
  const found = changedRules([censusChange(after)])
  expect(found).toHaveLength(1)
  expect(found[0].text).toBe(rule)
  expect(found[0].line).toBe(after.split("\n").indexOf(rule) + 1)
  expect(changedRules([censusChange(appendix(census()), appendix(census()) + "\n" + rule)])).toEqual([])
})

test("generated grammar census markers cannot hide hand-written or malformed rules", () => {
  const rule = "An `effect` function must return an Effect."
  for (const text of [
    "<!-- grammar-admission:start -->\n" + rule + "\n<!-- grammar-admission:end -->",
    census().replace("\n\n</details>", "\n\n" + rule + "\n\n</details>"),
    census().replace("DO NOT EDIT.", "hand-written") + "\n" + rule,
  ]) expect(changedRules([censusChange(appendix(text))]).some(s => s.text === rule)).toBe(true)
  expect(changedRules([{ path, before: "", after: appendix(census()) }]).length).toBeGreaterThan(0)
})

test("generated grammar census preserves the heading for an adjacent real rule", () => {
  const rule = "An `effect` function must return an Effect."
  const after = appendix(census() + "\n\n" + rule)
  const found = changedRules([censusChange(after)])
  expect(found).toHaveLength(1)
  expect(found[0].section).toBe("grammar-admission-inventory")
  expect(found[0].line).toBe(after.split("\n").indexOf(rule) + 1)
})

test("generated grammar census rejects forged extra table columns", () => {
  const forged = census().replace(censusRow(1).reason,
    censusRow(1).reason + " | An `effect` function must return an Effect.")
  expect(changedRules([censusChange(appendix(forged))]).length).toBeGreaterThan(0)
})

test("generated census edits preserve addition, deletion, replacement and move obligations", () => {
  const rule = "An `effect` function must return an Effect."
  const replacement = "An `effect` block means an Effect value."
  fc.assert(fc.property(
    fc.uniqueArray(fc.integer({ min: 1, max: 1000000 }), { minLength: 1, maxLength: 12 }),
    fc.integer({ min: 0, max: 6 }),
    (ids, padding) => {
      const beforeCensus = appendix(census(ids.map(censusRow)))
      const afterCensus = appendix(census(ids.map(id => censusRow(id + 1))))
      const before = beforeCensus + "\n".repeat(padding) + rule
      const after = afterCensus + "\n".repeat(padding) + replacement
      // Generated metadata changes add no rule, and deleting a rule adds no
      // obligation. Real additions and replacements retain their source line.
      expect(changedRules([censusChange(afterCensus, before)])).toEqual([])
      const added = changedRules([censusChange(after, beforeCensus)])
      expect(added.map(sentence => sentence.text)).toEqual([replacement])
      expect(added[0].line).toBe(after.split("\n").indexOf(replacement) + 1)
      const replaced = changedRules([censusChange(after, before)])
      expect(replaced.map(sentence => sentence.text)).toEqual([replacement])
      expect(replaced[0].line).toBe(added[0].line)
      expect(changedRules([
        censusChange(afterCensus, before),
        { path: "docs/design/src/001-functions.md", before: "", after: rule },
      ])).toEqual([])
    },
  ), { seed: 190, numRuns: 64 })
})
