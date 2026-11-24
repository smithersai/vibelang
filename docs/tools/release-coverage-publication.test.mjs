import { assertReleasePublication, finalPublication } from "./release-publication-checks.mjs"
import assert from "node:assert/strict"
import { copyFileSync, readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { coverage, targetRelease } from "./release-note-coverage-fixtures.mjs"
const root = fileURLToPath(new URL("../../", import.meta.url))
const require = createRequire(new URL("../../packages/compiler/package.json", import.meta.url))
const fc = require("fast-check")
const version = JSON.parse(readFileSync(join(root, "packages/compiler/package.json"), "utf8")).version
const final = finalPublication()
const normalize = text => text.replaceAll("`", "").replace(/\s+/g, " ").toLowerCase()
function releaseSections() {
  return readFileSync(new URL("../user/src/setup/release-notes.md", import.meta.url), "utf8").split(/^## /m).slice(1)
}
function release11() {
  const found = releaseSections().filter(section => section.split("\n")[0].replace(/ \(unreleased\)$/, "") === targetRelease)
  assert.equal(found.length, 1, "keep one source section for the release whose fixes these tests record")
  return found[0]
}
for (const entry of coverage) test("release 0.0.11 records the public fix: " + entry.key, { skip: !final }, () => {
  const rows = release11().match(/^- .*(?:\n(?!\n|[-*] |#{1,6} ).+)*/gm) || []
  assert.equal(rows.filter(row => entry.needles.every(needle => normalize(row).includes(needle))).length, 1, entry.key)
})
test("current publication omits the contrast helper-renderer record", { skip: !final }, () => {
  const sections = releaseSections()
  const current = sections.findIndex(section => section.split("\n")[0].replace(/ \(unreleased\)$/, "") === version)
  assert.ok(current >= 0)
  assert.doesNotMatch(sections.slice(0, current + 1).join("\n"), /site(?:['’]s)?\s+contrast\s+check/i)
})
function fixture(t) {
  const place = mkdtempSync(join(tmpdir(), "vibelang-note-coverage-"))
  t.after(() => rmSync(place, { recursive: true, force: true }))
  for (const file of ["docs/tools/release-docs.test.mjs", "docs/tools/release-docs.mjs", "docs/tools/release-publication-checks.mjs", "docs/tools/release-history.mjs"]) {
    mkdirSync(dirname(join(place, file)), { recursive: true })
    copyFileSync(join(root, file), join(place, file))
  }
  const manifest = join(place, "packages/compiler/package.json")
  mkdirSync(dirname(manifest), { recursive: true })
  writeFileSync(manifest, JSON.stringify({ version: "0.0.11" }))
  const notes = join(place, "docs/user/src/setup/release-notes.md")
  mkdirSync(dirname(notes), { recursive: true })
  const retained = ["- Editor parsing rejected `for try` `Stream` loops; they now parse.",
    "- A tool that reads a `.vibe` file through the TypeScript mapper now retains its diagnostic.",
    "- The migrate flow now reads compiler output with Windows line endings."].join("\n")
  return (row, location = "bugs") => {
    writeFileSync(notes, "# Release notes\n\n## 0.0.11 (unreleased)\n\n" +
      (location === "intro" ? row + "\n\n" : "") + "### Bugs fixed since 0.0.10\n\n" +
      retained + "\n\n" + (location === "bugs" ? row + "\n" : "") +
      "\n## 0.0.10\n" + (location === "history" ? row + "\n" : ""))
    try {
      assertReleasePublication(readFileSync(notes, "utf8"), "0.0.11")
      return { failed: false, message: "" }
    } catch (error) {
      return { failed: true, message: String(error) }
    }
  }
}
test("contrast bookkeeping guard covers typography case wrapping and historical placement", t => {
  const check = fixture(t)
  fc.assert(fc.property(fc.constantFrom("site's contrast check", "site’s contrast check"),
    fc.constantFrom(" ", "  ", "\t", "\n  "), fc.boolean(), fc.constantFrom("intro", "bugs", "history"),
    (phrase, space, uppercase, location) => {
      const text = (uppercase ? phrase.toUpperCase() : phrase).split(" ").join(space)
      const result = check("- The " + text + " now avoids a helper renderer.", location)
      assert.equal(result.failed, location !== "history", result.message)
    }), { numRuns: 40, seed: 110024, examples: [["site's contrast check", " ", false, "bugs"]] })
})
test("restored product fixes remain publishable through wording changes", t => {
  const check = fixture(t)
  fc.assert(fc.property(fc.constantFrom(...coverage.map(entry => entry.note)), fc.boolean(),
    fc.constantFrom(" ", "\n  "), fc.constantFrom("intro", "bugs", "history"), (note, uppercase, space, location) => {
      const text = (uppercase ? note.toUpperCase() : note).split(" ").join(space)
      const result = check("- " + text, location)
      assert.equal(result.failed, false, result.message)
    }), { numRuns: 40, seed: 110025, examples: coverage.map(entry => [entry.note, false, " ", "bugs"]) })
})

test("release notes do not enable the retired setup sidecar setting", { skip: !final }, () => {
  assert.doesNotMatch(normalize(release11()), /setup now turns on declarationsidecars/)
})
