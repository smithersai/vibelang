import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, readFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
const require = createRequire(new URL("../../packages/compiler/package.json", import.meta.url))
const fc = require("fast-check")
const privatePhrases = ["failures-spec check", "synthetic benchmark imports", "native compiler regression suite",
  "deployed-release check", "built-site validation", "example validation carried an unused",
  "formatter fuzz checks"]
function unpublished() {
  const notes = readFileSync(new URL("../user/src/setup/release-notes.md", import.meta.url), "utf8")
  const version = JSON.parse(readFileSync(new URL("../../packages/compiler/package.json", import.meta.url), "utf8")).version
  const releases = notes.split(/^## /m).slice(1)
  const candidate = releases.findIndex(release => release.split("\n")[0].replace(/ \(unreleased\)$/, "") === version)
  assert.ok(candidate >= 0)
  return releases.slice(0, candidate + 1).join("\n").replace(/\s+/g, " ")
}
for (const phrase of privatePhrases) test("publication omits internal bookkeeping: " + phrase, {
  skip: !process.env.VIBELANG_RELEASE_NOTES_FINAL
}, () => assert.equal(unpublished().toLowerCase().includes(phrase), false, phrase))
test("publication includes the missing documentation anchor fix once", {
  skip: !process.env.VIBELANG_RELEASE_NOTES_FINAL
}, () => {
  const notes = readFileSync(new URL("../user/src/setup/release-notes.md", import.meta.url), "utf8")
  const release = notes.split(/^## /m).slice(1).find(section => section.split("\n")[0].replace(/ \(unreleased\)$/, "") === "0.0.11")
  assert.ok(release, "retain the 0.0.11 release notes")
  const text = release.replace(/\s+/g, " ")
  assert.equal((text.match(/inline HTML anchors/gi) || []).length, 1)
  assert.match(text, /inline HTML anchors.*(?:jump|section|target)/i)
})
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-history-publication-"))
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
  const retained = ["- Editor parsing rejected `for try` `Stream` loops; they now parse.",
    "- A tool that reads a `.vibe` file through the TypeScript mapper now retains its diagnostic.",
    "- The migrate flow now reads compiler output with Windows line endings."].join("\n")
  return (row, location = "bugs") => {
    writeFileSync(notes, "# Release notes\n\n## 0.0.11 (unreleased)\n\n" +
      (location === "intro" ? row + "\n\n" : "") + "### Bugs fixed since 0.0.10\n\n" +
      retained + "\n\n" + (location === "bugs" ? row + "\n" : "") +
      "\n## 0.0.10\n" + (location === "history" ? row + "\n" : ""))
    const env = { ...process.env, VIBELANG_RELEASE_NOTES_FINAL: "1" }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync("node", ["--test", "--test-name-pattern=^current release notes describe user fixes without internal CI or fuzz bookkeeping$",
      join(root, "docs/tools/release-docs.test.mjs")], { env, encoding: "utf8", timeout: 15_000 })
    assert.doesNotMatch(result.stderr, /called recursively/)
    assert.match(result.stdout, /current release notes describe user fixes without internal CI or fuzz bookkeeping/)
    assert.match(result.stdout, /(?:pass|fail)\s+1\b/)
    return result
  }
}
test("validation bookkeeping guard covers wrapping case and historical placement", t => {
  const check = fixture(t)
  fc.assert(fc.property(fc.constantFrom(...privatePhrases), fc.constantFrom(" ", "  ", "\t", "\n  "),
    fc.boolean(), fc.constantFrom("intro", "bugs", "history"), (phrase, space, uppercase, location) => {
      const words = (uppercase ? phrase.toUpperCase() : phrase).split(" ").join(space)
      const result = check("- The " + words + " now records its internal result.", location)
      assert.equal(result.status, location === "history" ? 0 : 1, result.stdout + result.stderr)
    }), { numRuns: 40, seed: 110023, examples: privatePhrases.map(phrase => [phrase, " ", false, "bugs"]) })
})
test("observable benchmark and contributor command fixes stay publishable", t => {
  const check = fixture(t)
  for (const row of [
    "- The LSP benchmark left its language server running on a protocol failure; it now stops the server.",
    "- Benchmark projects missed scoped dependencies; staging now merges those packages.",
    "- A failed remote build command left a temporary file behind; it now removes that file.",
    "- The contributor compiler-case command lacked runtime dependencies; its recipe now installs them."
  ]) {
    const result = check(row)
    assert.equal(result.status, 0, result.stdout + result.stderr)
  }
})

test("the 0.0.11 anchor note remains valid after a later candidate", t => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-history-later-release-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const path = join(root, "docs/tools/release-history-publication.test.mjs")
  mkdirSync(dirname(path), { recursive: true })
  copyFileSync(fileURLToPath(import.meta.url), path)
  const manifest = join(root, "packages/compiler/package.json")
  mkdirSync(dirname(manifest), { recursive: true })
  writeFileSync(manifest, JSON.stringify({ version: "0.0.12" }))
  symlinkSync(realpathSync(fileURLToPath(new URL("../../packages/compiler/node_modules", import.meta.url))),
    join(root, "packages/compiler/node_modules"), "dir")
  const notes = join(root, "docs/user/src/setup/release-notes.md")
  mkdirSync(dirname(notes), { recursive: true })
  writeFileSync(notes, "# Release notes\n\n## 0.0.12 (unreleased)\n\n### Bugs fixed since 0.0.11\n\n- Another fix.\n\n" +
    "## 0.0.11\n\n### Bugs fixed since 0.0.10\n\n" +
    "- Links to inline HTML anchors did not jump to sections; those anchors now keep their targets.\n\n## 0.0.10\n")
  const env = { ...process.env, VIBELANG_RELEASE_NOTES_FINAL: "1" }
  delete env.NODE_TEST_CONTEXT
  const result = spawnSync("node", ["--test", "--test-name-pattern=^publication includes the missing documentation anchor fix once$", path],
    { env, encoding: "utf8", timeout: 15_000 })
  assert.match(result.stdout, /publication includes the missing documentation anchor fix once/)
  assert.match(result.stdout, /pass\s+1\b/)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
