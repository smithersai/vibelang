// Publication requirement: the user-facing bug list excludes internal CI and
// fuzz bookkeeping. Exercise the real publication guard with isolated notes.
import { assertReleasePublication, assertReleaseContrast } from "./release-publication-checks.mjs"
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
  for (const file of ["docs/tools/release-docs.test.mjs", "docs/tools/release-docs.mjs", "docs/tools/release-publication-checks.mjs", "docs/tools/release-history.mjs"]) {
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
    check(row, location = "bugs", finalHeading = false) {
      const source = goodNotes.replace("<!-- injected-row -->", location === "bugs" ? row : "").replace("<!-- intro-row -->", location === "intro" ? row : "")
      writeFileSync(notes, finalHeading ? source.replace("## 0.0.11 (unreleased)", "## 0.0.11") : source)
      const env = { ...process.env, VIBELANG_RELEASE_NOTES_FINAL: "1" }
      if (finalHeading) delete env.VIBELANG_RELEASE_NOTES_FINAL
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

test("publication accepts the public Fuzz modules named in code and still rejects fuzz bookkeeping", () => {
  const inject = row => goodNotes.replace("<!-- injected-row -->", row).replace("<!-- intro-row -->", "")
  const api = "- A lost update passed every property check. `Experimental.Fuzz.run` with `Experimental.FuzzSimulation.execution()` now finds it, guided by `Fuzz.observe(label)`."
  assert.doesNotThrow(() => assertReleasePublication(inject(api), "0.0.11"))
  for (const row of [
    "- The fuzz splicer now keeps `Experimental.Fuzz` seeds.",
    "- `go-vibelangfuzz` now runs `Experimental.Fuzz`.",
    "- Experimental.Fuzz targets now run before merging.",
    "- The `fuzz` target now passes.",
    "- The `Experimental.Fuzz` fuzz campaign now passes."
  ]) assert.throws(() => assertReleasePublication(inject(row), "0.0.11"), /internal bookkeeping/, row)
})

test("publication retains a user-visible compiler fix that mentions CI", t => {
  const result = fixture(t).check("- A compiler error in CI lost its source location; diagnostics now retain the location.")
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

test("publication rejects test-only introductory bullets", t => {
  const result = fixture(t).check("- The mask smoke test now waits for a start signal.", "intro")
  assert.equal(result.status, 1, result.stdout + result.stderr)
})

const internalSuiteRecords = [
  "Migration oracle regression tests", "compiler regression suite", "compiler’s keyword coverage check",
  "pin regression suite", "CI-health reports", "Declaration-oracle tests",
  "snippet tools’ pending-output test fixtures", "narrow hosted CI checks",
  "contributor checks", "Contributor queue instructions", "contribution guide", "Publication checks",
  "Release rehearsals", "Release-history checks", "documentation check", "diagnostic reference check",
  "Appendix diagnostic replay", "fixtures now initialize"
]
test("publication rejects internal suite and CI report records across spelling variants", () => {
  fc.assert(fc.property(fc.constantFrom(...internalSuiteRecords), fc.constantFrom(" ", "  ", "\t", "\n  "),
    fc.boolean(), fc.boolean(), (phrase, separator, uppercase, intro) => {
      const text = (uppercase ? phrase.toUpperCase() : phrase).split(" ").join(separator)
      const notes = goodNotes.replace("<!-- injected-row -->", intro ? "" : "- The " + text + " now passes.")
        .replace("<!-- intro-row -->", intro ? "- The " + text + " now passes." : "")
      assert.throws(() => assertReleasePublication(notes, "0.0.11"))
    }), { numRuns: 160, seed: 110039, examples: internalSuiteRecords.map(phrase => [phrase, " ", false, false]) })
})


test("a released heading enforces publication hygiene without an environment flag", t => {
  const f = fixture(t)
  const good = f.check(publicFix, "bugs", true)
  assert.equal(good.status, 0, good.stdout + good.stderr)
  const bad = f.check(witness, "bugs", true)
  assert.equal(bad.status, 1, bad.stdout + bad.stderr)
})

test("a new release keeps previously published fixes in their original version", () => {
  fc.assert(fc.property(fc.integer({ min: 12, max: 999 }), fc.boolean(), (patch, unreleased) => {
    const version = "0.0." + patch
    const notes = "# Release notes\n\n## " + version + (unreleased ? " (unreleased)" : "") +
      "\n\n### Bugs fixed since 0.0.11\n\n" + publicFix + "\n\n" +
      goodNotes.replace("# Release notes\n\n", "").replace("0.0.11 (unreleased)", "0.0.11")
    assert.doesNotThrow(() => assertReleasePublication(notes, version))
    assert.throws(() => assertReleasePublication(notes.replace(publicFix, publicFix + "\n" + publicFix), version),
      /each user-facing fix appears once/)
    assert.throws(() => assertReleasePublication(notes.replace(publicFix, witness), version))
    assert.throws(() => assertReleasePublication(notes.replace("Editor parsing rejected", "Editor formerly rejected"), version),
      /retain the user fix once/)
  }), { numRuns: 80, seed: 120012, examples: [[12, false], [12, true]] })
})

const unrelatedNotes = Array.from({ length: 256 }, (_, index) =>
  "- The editor retains unrelated_marker_" + index + " when a file changes. " + "Context retained. ".repeat(16))

function diagnosticNotes(row, position) {
  const notes = [...unrelatedNotes]
  notes.splice(position, 0, row)
  return goodNotes.replace("<!-- injected-row -->", notes.join("\n"))
}

function assertRejectedEntry(check, notes, row) {
  assert.throws(() => check(notes, "0.0.11"), error => {
    assert.equal(error.code, "ERR_ASSERTION")
    assert.ok(error.actual === row, "the diagnostic must contain exactly the rejected entry")
    assert.ok(!error.message.includes("unrelated_marker_"), "unrelated entries do not belong in the diagnostic")
    return true
  })
}

test("publication diagnostics isolate a rejected entry at every list boundary", () => {
  for (const position of [0, 1, 128, 255, 256]) {
    assertRejectedEntry(assertReleasePublication, diagnosticNotes(witness, position), witness)
  }
})

test("publication diagnostics retain wrapped entry text and spelling variants", () => {
  fc.assert(fc.property(fc.constantFrom("merge gate", "forms-table check", "contributor checks", "fuzz"),
    fc.constantFrom(" ", "  ", "\t", "\n  "), fc.boolean(), fc.integer({ min: 0, max: 256 }),
    (phrase, separator, uppercase, position) => {
      const text = (uppercase ? phrase.toUpperCase() : phrase).split(" ").join(separator)
      const row = "- The " + text + " now passes.\n  The complete entry remains visible."
      assertRejectedEntry(assertReleasePublication, diagnosticNotes(row, position), row)
    }), { numRuns: 64, seed: 120047 })
})

test("contrast diagnostics isolate the rejected entry without losing surrounding-note validation", () => {
  const row = "- The site's contrast check now passes."
  assertRejectedEntry(assertReleaseContrast, diagnosticNotes(row, 128), row)
  const allowed = diagnosticNotes(publicFix, 128)
  assert.doesNotThrow(() => assertReleasePublication(allowed, "0.0.11"))
  assert.doesNotThrow(() => assertReleaseContrast(allowed, "0.0.11"))
})

test("the strict publication command reports the rejected entry without the rest of a long release", t => {
  const result = fixture(t).check([...unrelatedNotes.slice(0, 128), witness, ...unrelatedNotes.slice(128)].join("\n"))
  const outputBytes = Buffer.byteLength(result.stdout + result.stderr)
  t.diagnostic("publication diagnostic output bytes: " + outputBytes)
  assert.equal(result.status, 1)
  assert.ok(!result.stdout.includes("unrelated_marker_"), "the command must not print unrelated release entries")
  assert.match(result.stdout, /merge gate/)
  assert.ok(Buffer.byteLength(result.stdout + result.stderr) < 8000, "a single short rejected entry has a short diagnostic")
})
