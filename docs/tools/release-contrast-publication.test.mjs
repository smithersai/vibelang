import { assertReleaseContrast } from "./release-publication-checks.mjs"
// User release requirement: no internal CI or fuzz rows in publication notes.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
const require = createRequire(new URL("../../packages/compiler/package.json", import.meta.url))
const fc = require("fast-check")
function fixture(t, cli = false) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-contrast-publication-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const file of ["docs/tools/release-docs.test.mjs", "docs/tools/release-docs.mjs", "docs/tools/release-publication-checks.mjs"]) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    copyFileSync(fileURLToPath(new URL("../../" + file, import.meta.url)), join(root, file))
  }
  const manifest = join(root, "packages/compiler/package.json")
  mkdirSync(dirname(manifest), { recursive: true })
  writeFileSync(manifest, JSON.stringify({ version: "0.0.11" }))
  const notes = join(root, "docs/user/src/setup/release-notes.md")
  mkdirSync(dirname(notes), { recursive: true })
  return (row, intro = false, historical = false) => {
    writeFileSync(notes, "# Release notes\n\n## 0.0.11 (unreleased)\n\n" + (intro && !historical ? row + "\n\n" : "") +
      "### Bugs fixed since 0.0.10\n\n" + (intro || historical ? "- A product error is repaired." : row) + "\n\n## 0.0.10\n" + (historical ? row + "\n" : ""))
    if (cli) {
      const env = { ...process.env, VIBELANG_RELEASE_NOTES_FINAL: "1" }
      delete env.NODE_TEST_CONTEXT
      const result = spawnSync("node", ["--test", "--test-name-pattern=^current publication notes omit internal contrast audit records$", join(root, "docs/tools/release-docs.test.mjs")], { env, encoding: "utf8", timeout: 15_000 })
      assert.ifError(result.error)
      assert.ok(result.status === 0 || result.status === 1, JSON.stringify({ status: result.status, signal: result.signal }))
      assert.match(result.stdout, /current publication notes omit internal contrast audit records/)
      return { failed: result.status !== 0, message: result.stdout + result.stderr }
    }
    try {
      assertReleaseContrast(readFileSync(notes, "utf8"), "0.0.11")
      return { failed: false, message: "" }
    } catch (error) {
      return { failed: true, message: String(error) }
    }
  }
}
test("contrast audit records are rejected in introductory and bug-list bullets", t => {
  const check = fixture(t, true)
  for (const intro of [false, true]) {
    const result = check("- A browser crash during the site's contrast check lost its audit state.", intro)
    assert.equal(result.failed, true, result.message)
  }
})
test("contrast publication guard covers case, wrapping and apostrophe variants", t => {
  const check = fixture(t)
  fc.assert(fc.property(fc.constantFrom("site's contrast check", "site’s contrast check", "site contrast check", "contrast audit diagnostics", "contrast diagnostics"),
    fc.constantFrom(" ", "  ", "\t", "\n  "), fc.boolean(), fc.constantFrom("intro", "bugs", "history"), (phrase, space, uppercase, location) => {
      const text = (uppercase ? phrase.toUpperCase() : phrase).split(" ").join(space)
      const result = check("- The " + text + " now records browser diagnostics.", location === "intro", location === "history")
      assert.equal(result.failed, location !== "history", result.message)
    }), { numRuns: 20, seed: 110019, examples: [["site's contrast check", " ", false, "bugs"], ["contrast diagnostics", " ", false, "bugs"], ["site’s contrast check", "\n  ", true, "intro"]] })
})
test("public contrast and Promise comparison fixes remain publishable", t => {
  const check = fixture(t)
  for (const row of ["- Links in the dark theme had low contrast; their colors now meet the required ratio.",
    "- The Promise comparison now contrasts async return assimilation with Effect success data.",
    "- Release notes included internal audit records; the publication list now retains user-facing changes."]) {
    const result = check(row)
    assert.equal(result.failed, false, result.message)
  }
})
