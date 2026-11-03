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
  expect(changedRules([censusChange(appendix(census()), appendix(census()) + "\n" + rule)])[0].removed).toBe(true)
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
