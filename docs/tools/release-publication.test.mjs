// Publication requirement: the user-facing bug list excludes internal CI and
// fuzz bookkeeping. Exercise the real publication guard with isolated notes.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const require = createRequire(new URL("../../packages/compiler/package.json", import.meta.url))
const fc = require("fast-check")
const witness = "- The merge gate skipped known hang reproductions; it now runs bounded hang probes before accepting the change."
const goodNotes = readFileSync(new URL("./testdata/release-publication-good.md", import.meta.url), "utf8")
const publicFix = "- A valid arithmetic expression was rejected; the compiler now accepts it."

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-publication-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const file of ["docs/tools/release-docs.test.mjs", "docs/tools/release-docs.mjs"]) {
    const destination = join(root, file)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(fileURLToPath(new URL("../../" + file, import.meta.url)), destination)
  }
  const manifest = join(root, "packages/compiler/package.json")
  mkdirSync(dirname(manifest), { recursive: true })
  writeFileSync(manifest, JSON.stringify({ version: "0.0.11" }))
  const notes = join(root, "docs/user/src/setup/release-notes.md")
  mkdirSync(dirname(notes), { recursive: true })
  return {
    check(row, location = "bugs") {
      writeFileSync(notes, goodNotes.replace("<!-- injected-row -->", location === "bugs" ? row : "").replace("<!-- intro-row -->", location === "intro" ? row : ""))
      const env = { ...process.env, VIBELANG_RELEASE_NOTES_FINAL: "1" }
      delete env.NODE_TEST_CONTEXT
      const result = spawnSync("node", ["--test", "--test-name-pattern=^current release notes describe user fixes without internal CI or fuzz bookkeeping$", join(root, "docs/tools/release-docs.test.mjs")], {
        env,
        encoding: "utf8", timeout: 15_000,
      })
      assert.doesNotMatch(result.stderr, /called recursively/)
      assert.match(result.stdout, /current release notes describe user fixes/)
      assert.match(result.stdout, /(?:pass|fail)\s+1\b/)
      return result
    }
  }
}

test("publication rejects the minimized merge-gate note while retaining the Windows product fix", t => {
  const f = fixture(t)
  const good = f.check(publicFix)
  assert.equal(good.status, 0, good.stdout + good.stderr)
  const bad = f.check(witness)
  assert.equal(bad.status, 1, bad.stdout + bad.stderr)
})

test("publication rejects hang-gate bookkeeping across case and whitespace variants", t => {
  const f = fixture(t)
  fc.assert(fc.property(
    fc.constantFrom("merge gate", "bounded hang probes", "stale hang marker", "forms-table check", "mask smoke test", "LSP smoke test", "editor smoke test", "Compiler validation treated an error name", "fork startup checks", "CI reused an older node_modules tree", "fuzz splicer"),
    fc.constantFrom(" ", "  ", "\t", "\n  "), fc.boolean(), fc.boolean(),
    (phrase, separator, uppercase, intro) => {
      const text = (uppercase ? phrase.toUpperCase() : phrase).split(" ").join(separator)
      const result = f.check("- The " + text + " now checks maintainer validation.", intro ? "intro" : "bugs")
      assert.equal(result.status, 1, result.stdout + result.stderr)
    }
  ), { numRuns: 40, seed: 110018, examples: [["merge gate", " ", false, false], ["bounded hang probes", "  ", true, true], ["stale hang marker", "\t", false, false], ["fuzz splicer", "\n  ", false, true], ["LSP smoke test", " ", false, true]] })
})

test("publication retains a user-visible compiler fix that mentions CI", t => {
  const result = fixture(t).check("- A compiler error in CI lost its source location; diagnostics now retain the location.")
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

test("publication rejects test-only introductory bullets", t => {
  const result = fixture(t).check("- The mask smoke test now waits for a start signal.", "intro")
  assert.equal(result.status, 1, result.stdout + result.stderr)
})
