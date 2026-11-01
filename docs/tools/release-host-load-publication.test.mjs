// User release requirement: publication notes list user-visible fixes, not
// internal CI timing, build-host or fuzz bookkeeping.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const privatePhrases = ["kernel law suite", "release checks could fail", "compiler fuzz checks could stop",
  "runtime's `main` tests", "compiler package's tests could fail", "`fuzzcommandline` could fail",
  "child-process tests of"]
function unpublished() {
  const notes = readFileSync(new URL("../user/src/setup/release-notes.md", import.meta.url), "utf8")
  const version = JSON.parse(readFileSync(new URL("../../packages/compiler/package.json", import.meta.url), "utf8")).version
  const releases = notes.split(/^## /m).slice(1)
  const candidate = releases.findIndex(release => release.split("\n")[0].replace(/ \(unreleased\)$/, "") === version)
  assert.ok(candidate >= 0, "the candidate version has a release-notes section")
  return releases.slice(0, candidate + 1).join("\n").replace(/\s+/g, " ").toLowerCase()
}
for (const phrase of privatePhrases) test("publication omits build-host and CI records: " + phrase, {
  skip: !process.env.VIBELANG_RELEASE_NOTES_FINAL
}, () => assert.equal(unpublished().includes(phrase.toLowerCase()), false, phrase))

test("the phrase list matches records only, not public fixes that mention hosts or checks", () => {
  const publicRows = [
    "- `vibelang --fix` could repeatedly recheck a large project; it now traces referenced declarations.",
    "- Exhaustiveness checks rejected an open object pattern; they now accept it.",
    "- `main` reported typed error fields without their names; it now prints each field."
  ].join(" ").toLowerCase()
  for (const phrase of privatePhrases) assert.equal(publicRows.includes(phrase.toLowerCase()), false, phrase)
})
