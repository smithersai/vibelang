// Publication notes retain user-visible fixes and omit validation-only records.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
const require = createRequire(new URL("../../packages/compiler/package.json", import.meta.url))
const fc = require("fast-check")
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-concurrent-publication-"))
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
  const retained = [
    "- Editor parsing rejected `for try` `Stream` loops; they now parse.",
    "- A tool that reads a `.vibe` file through the TypeScript mapper now retains its diagnostic.",
    "- The migrate flow now reads compiler output with Windows line endings."
  ].join("\n")
  return (row, location = "bugs") => {
    writeFileSync(notes, "# Release notes\n\n## 0.0.11 (unreleased)\n\n" + (location === "intro" ? row + "\n\n" : "") +
      "### Bugs fixed since 0.0.10\n\n" + retained + "\n\n" + (location === "bugs" ? row + "\n" : "") +
      "\n## 0.0.10\n" + (location === "history" ? row + "\n" : ""))
    const env = { ...process.env, VIBELANG_RELEASE_NOTES_FINAL: "1" }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync("node", ["--test", "--test-name-pattern=^current release notes describe user fixes without internal CI or fuzz bookkeeping$", join(root, "docs/tools/release-docs.test.mjs")], { env, encoding: "utf8", timeout: 15_000 })
    assert.doesNotMatch(result.stderr, /called recursively/)
    assert.match(result.stdout, /current release notes describe user fixes without internal CI or fuzz bookkeeping/)
    assert.match(result.stdout, /(?:pass|fail)\s+1\b/)
    return result
  }
}
test("publication notes omit internal concurrency coverage records", {
  skip: !process.env.VIBELANG_RELEASE_NOTES_FINAL
}, () => {
  const notes = readFileSync(new URL("../user/src/setup/release-notes.md", import.meta.url), "utf8")
  const version = JSON.parse(readFileSync(new URL("../../packages/compiler/package.json", import.meta.url), "utf8")).version
  const releases = notes.split(/^## /m).slice(1)
  const candidate = releases.findIndex(release => release.split("\n")[0].replace(/ \(unreleased\)$/, "") === version)
  assert.ok(candidate >= 0)
  const rows = releases.slice(0, candidate + 1).flatMap(release => release.match(/^- .*(?:\n(?!\n|[-*] |#{1,6} ).+)*/gm) ?? [])
  assert.deepEqual(rows.filter(row => /\bfuzz\s+suite\b/i.test(row)), [])
})
test("concurrency coverage guard covers case wrapping and historical placement", t => {
  const check = fixture(t)
  fc.assert(fc.property(fc.constantFrom("fuzz suite", "for concurrent fuzz coverage", "concurrency fuzz coverage"),
    fc.constantFrom(" ", "  ", "\t", "\n  "), fc.boolean(), fc.constantFrom("intro", "bugs", "history"), (phrase, space, uppercase, location) => {
      const text = (uppercase ? phrase.toUpperCase() : phrase).split(" ").join(space)
      const result = check("- The " + text + " now checks expected diagnostics.", location)
      assert.equal(result.status, location === "history" ? 0 : 1, result.stdout + result.stderr)
    }), { numRuns: 20, seed: 110022, examples: [["fuzz suite", " ", false, "bugs"], ["for concurrent fuzz coverage", "\n  ", true, "intro"]] })
})
test("public concurrent-loop fixes and schema explanations remain publishable", t => {
  const check = fixture(t)
  for (const row of [
    "- A for concurrent head evaluated a computed key twice; it now evaluates the key once.",
    "- The schema guide now explains why a `Schema.Top` reference can report both `EK2109` diagnostics."
  ]) {
    const result = check(row)
    assert.equal(result.status, 0, result.stdout + result.stderr)
  }
})
