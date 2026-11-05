import { expect, test } from "bun:test"
import fc from "fast-check"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { assertRecordedPublication, checkRecordedPublication, readPublicationSnapshot, recordPublicationSnapshot } from "./release-history.mjs"

const root = fileURLToPath(new URL("../../", import.meta.url))
const notes = (version, baseline, unreleased = true) =>
  "## " + version + (unreleased ? " (unreleased)" : "") + "\n### Bugs fixed since " + baseline +
  "\n### Upgrade from " + baseline + "\n\n- A user-visible fix.\n\n## " + baseline + "\n"

test("repository notes follow the recorded npm publication", () => {
  expect(() => checkRecordedPublication(root)).not.toThrow()
})

test("an unpublished candidate cannot be presented as a published baseline", () => {
  const split = "## 0.0.12 (unreleased)\n### Bugs fixed since 0.0.11\n## 0.0.11\n### Bugs fixed since 0.0.10\n## 0.0.10\n"
  expect(() => assertRecordedPublication(split, "0.0.11", "0.0.10")).toThrow(/compiler candidate/)
  expect(() => assertRecordedPublication(notes("0.0.11", "0.0.10"), "0.0.11", "0.0.10")).not.toThrow()
  expect(() => assertRecordedPublication(notes("0.0.12", "0.0.11"), "0.0.11", "0.0.11")).not.toThrow()
})

test("newer minor and major candidates retain the published baseline", () => {
  for (const candidate of ["0.1.0", "1.0.0", "2.3.4"]) {
    expect(() => assertRecordedPublication(notes(candidate, "0.0.11"), candidate, "0.0.11")).not.toThrow()
    expect(() => assertRecordedPublication(notes(candidate, "0.0.10"), candidate, "0.0.11")).toThrow(/actually published/)
  }
  for (const candidate of ["0.0.10", "0.0.9"]) {
    expect(() => assertRecordedPublication(notes(candidate, "0.0.11", false), candidate, "0.0.11")).toThrow(/newer/)
  }
})

test("publication recording validates finalized notes and never rolls history back", () => {
  const fixture = mkdtempSync(join(tmpdir(), "release-history-"))
  const snapshot = join(fixture, "docs/tools/release-publication-snapshot.json")
  try {
    mkdirSync(join(fixture, "docs/tools"), { recursive: true })
    mkdirSync(join(fixture, "docs/user/src/setup"), { recursive: true })
    mkdirSync(join(fixture, "packages/compiler"), { recursive: true })
    writeFileSync(join(fixture, "packages/compiler/package.json"), JSON.stringify({ version: "0.0.11" }))
    writeFileSync(join(fixture, "docs/user/src/setup/release-notes.md"), notes("0.0.11", "0.0.10", false))
    writeFileSync(snapshot, JSON.stringify({ package: "vibelang", version: "0.0.10" }))
    recordPublicationSnapshot(fixture, "0.0.11")
    expect(readPublicationSnapshot(fixture).version).toBe("0.0.11")
    writeFileSync(join(fixture, "docs/user/src/setup/release-notes.md"), notes("0.0.12", "0.0.11"))
    expect(() => recordPublicationSnapshot(fixture, "0.0.11")).not.toThrow()
    expect(() => checkRecordedPublication(fixture)).not.toThrow()
    const saved = readFileSync(snapshot, "utf8")
    expect(() => recordPublicationSnapshot(fixture, "0.0.10")).toThrow(/backwards/)
    for (const invalid of ["", "next", "0.0", "0.0.12-beta.1", "0.0.12"]) {
      expect(() => recordPublicationSnapshot(fixture, invalid)).toThrow()
      expect(readFileSync(snapshot, "utf8")).toBe(saved)
    }
    writeFileSync(join(fixture, "docs/user/src/setup/release-notes.md"), notes("0.0.11", "0.0.10"))
    expect(() => checkRecordedPublication(fixture)).toThrow(/already published/)
  } finally { rmSync(fixture, { recursive: true, force: true }) }
})

test("generated publication states retain the candidate and real upgrade baseline", () => {
  fc.assert(fc.property(fc.record({ major: fc.integer({ min: 0, max: 12 }), minor: fc.integer({ min: 0, max: 20 }), patch: fc.integer({ min: 1, max: 80 }), bump: fc.constantFrom("patch", "minor", "major") }), ({ major, minor, patch, bump }) => {
    const prefix = major + "." + minor + "."
    const published = prefix + patch
    const candidate = bump === "patch" ? prefix + (patch + 1) : bump === "minor" ? major + "." + (minor + 1) + ".0" : (major + 1) + ".0.0"
    const parts = candidate.split(".").map(Number)
    const future = parts[0] + "." + parts[1] + "." + (parts[2] + 1)
    for (const marker of [true, false]) {
      expect(() => assertRecordedPublication(notes(candidate, published, marker), candidate, published)).not.toThrow()
    }
    const split = "## " + future + " (unreleased)\n### Bugs fixed since " + candidate + "\n## " + candidate +
      "\n### Bugs fixed since " + published + "\n## " + published + "\n"
    expect(() => assertRecordedPublication(split, candidate, published)).toThrow(/compiler candidate/)
    expect(() => assertRecordedPublication(notes(candidate, published), published, published)).not.toThrow()
    expect(() => assertRecordedPublication(notes(candidate, published).replace("### Upgrade from " + published, "### Upgrade from " + candidate), published, published)).toThrow(/recorded npm/)
    expect(() => assertRecordedPublication(notes(published, prefix + (patch - 1), false), published, published)).not.toThrow()
    expect(() => assertRecordedPublication(notes(published, prefix + (patch - 1)), published, published)).toThrow(/already published/)
  }), { numRuns: 250 })
})
