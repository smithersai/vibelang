// The unreleased section keeps fixes under its bug list and upgrade rows in its upgrade tables.
// Rows that land at the top of the section or inside another heading read as upgrade steps.
import assert from "node:assert/strict"
import fc from "fast-check"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { assertReleaseStructure } from "./release-publication-checks.mjs"

const good = [
  "# Release notes", "", "## 0.0.11 (unreleased)", "", "Update everything together.", "",
  "### Upgrade from 0.0.10", "", "- A shallow rule.", "", "| Before | After and repair |", "| --- | --- |", "| `a` | `b` |", "",
  "### Bugs fixed since 0.0.10", "", "- A row.", "", "#### Docs", "", "- Another row.", "", "## 0.0.10", "", "- Old.", "",
].join("\n")

test("a section with fixes under its bug list and rows under its upgrade heading passes", () => {
  assertReleaseStructure(good, "0.0.11")
})

test("a bug row at the top of the section fails", () => {
  const bad = good.replace("Update everything together.\n", "Update everything together.\n- A misplaced row.\n")
  assert.throws(() => assertReleaseStructure(bad, "0.0.11"), /before the first heading/)
})

test("an upgrade-table row at the top of the section fails", () => {
  const bad = good.replace("Update everything together.\n", "Update everything together.\n| `x` | `y` |\n")
  assert.throws(() => assertReleaseStructure(bad, "0.0.11"), /before the first heading/)
})

test("an upgrade under its own heading fails", () => {
  const bad = good.replace("### Bugs fixed", "### Nested schema alias upgrade\n\n- A misplaced row.\n\n### Bugs fixed")
  assert.throws(() => assertReleaseStructure(bad, "0.0.11"), /Nested schema alias upgrade/)
})

test("older releases keep their own shape", () => {
  assertReleaseStructure(good.replace("## 0.0.10\n", "## 0.0.10\n\n### Anything\n"), "0.0.11")
})

test("current release notes keep fixes and upgrade rows under their headings", () => {
  const version = JSON.parse(readFileSync(new URL("../../packages/compiler/package.json", import.meta.url), "utf8")).version
  assertReleaseStructure(readFileSync(new URL("../user/src/setup/release-notes.md", import.meta.url), "utf8"), version)
})

test("each supported release section rejects a duplicate", () => {
  for (const heading of ["Upgrade from 0.0.10", "Bugs fixed since 0.0.10", "Configuration upgrade", "Diagnostic codes"]) {
    const once = good.includes("### " + heading + "\n") ? good :
      good.replace("## 0.0.10\n", "### " + heading + "\n\nA note.\n\n## 0.0.10\n")
    assertReleaseStructure(once, "0.0.11")
    assert.throws(() => assertReleaseStructure(once.replace("## 0.0.10\n",
      "### " + heading + "\n\nA second note.\n\n## 0.0.10\n"), "0.0.11"), /duplicate release section/)
  }
})

test("fast-check: duplicate sections fail among independent release notes", () => {
  fc.assert(fc.property(
    fc.uniqueArray(fc.stringMatching(/^[a-z]{1,12}$/), { maxLength: 12 }),
    fc.constantFrom("Upgrade from 0.0.10", "Bugs fixed since 0.0.10"),
    (names, heading) => {
      const unrelated = names.map(name => "### Notes " + name + "\n\nA note.\n\n").join("")
      const once = good.replace("## 0.0.10\n", unrelated + "## 0.0.10\n")
      assertReleaseStructure(once, "0.0.11")
      assert.throws(() => assertReleaseStructure(once.replace("## 0.0.10\n",
        "### " + heading + "\n\nAnother note.\n\n## 0.0.10\n"), "0.0.11"), /duplicate release section/)
    }
  ), { seed: 511003, numRuns: 80 })
})
