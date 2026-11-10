import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import fc from "fast-check"
import { checkEntry } from "./rule-evidence"

const fixtures = [
  {
    "file": "docs/tools/vip43-pending.test.ts",
    "path": "docs/design/vips/0043-theorems.md",
    "section": "Decision",
    "text": "`sumNonNegative` needs no tactic: a theorem that calls no loop function lowers to a Dafny lemma, and Dafny's automatic induction proves it."
  },
  {
    "file": "docs/tools/vip44-pending.test.ts",
    "path": "docs/design/vips/0044-durable-values.md",
    "section": "Decision",
    "text": "A type with no schema form is `EK2109`, the error `schema` already reports."
  }
]
const source = (path: string) => {
  const file = resolve(import.meta.dir, "../..", path)
  return existsSync(file) ? readFileSync(file, "utf8") : ""
}

for (const fixture of fixtures) test("accepted proposal retains its exact implementation obligation: " + fixture.path, async () => {
  const result = await checkEntry({ base: "base", head: "head", changes: [
    { path: fixture.path, before: "", after: "## " + fixture.section + "\n\n" + fixture.text },
    { path: fixture.file, before: "", after: source(fixture.file) }
  ] })
  expect(result.rules).toBe(1)
  expect(result.pending).toBe(1)
  expect(result.findings).toEqual([])
  expect(source(fixture.file)).not.toContain("0043-theorems-open.md")
})

test("fast-check: restored proposal obligations cannot cover an additional language rule", async () => {
  await fc.assert(fc.asyncProperty(
    fc.constantFrom(...fixtures), fc.integer({ min: 1, max: 9999 }),
    async (fixture, code) => {
      const result = await checkEntry({ base: "base", head: "head", changes: [
        { path: fixture.path, before: "", after: "## " + fixture.section + "\n\n" + fixture.text + "\n\n`form" + code + "` must compile." },
        { path: fixture.file, before: "", after: source(fixture.file) }
      ] })
      expect(result.pending).toBe(1)
      expect(result.findings).toHaveLength(1)
    }
  ), { seed: 20261109, numRuns: 100 })
})
