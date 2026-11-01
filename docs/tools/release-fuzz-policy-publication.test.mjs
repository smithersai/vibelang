import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const internalRecord = text => /\bcompiler\s+fuzz\s+validation\s+rejected\s+configured\b/i.test(text.replaceAll("`", ""))
const notes = readFileSync(new URL("../user/src/setup/release-notes.md", import.meta.url), "utf8")
const version = JSON.parse(readFileSync(new URL("../../packages/compiler/package.json", import.meta.url), "utf8")).version
function unpublished() {
  const releases = notes.split(/^## /m).slice(1)
  const candidate = releases.findIndex(release => release.split("\n")[0].replace(/ \(unreleased\)$/, "") === version)
  assert.ok(candidate >= 0, "the candidate version has a release-notes section")
  return releases.slice(0, candidate + 1).join("\n")
}
test("publication omits the compiler fuzz validation policy record", {
  skip: !process.env.VIBELANG_RELEASE_NOTES_FINAL
}, () => assert.equal(internalRecord(unpublished()), false, "remove the internal compiler fuzz validation row"))

test("the guard recognizes fuzz validation records across typography and wrapping", () => {
  let state = 0x110034
  for (let i = 0; i < 40; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const space = [" ", "\n", "  "][state % 3]
    const words = ["Compiler", "fuzz", "validation", "rejected", "configured"].map((word, n) => {
      const text = (state >>> n) & 1 ? word.toUpperCase() : word
      return (state >>> (n + 3)) & 1 ? "`" + text + "`" : text
    })
    assert.equal(internalRecord("- " + words.join(space) + " await warning overrides; it now accepts them."), true)
  }
})

test("the guard retains public compiler diagnostic category and override fixes", () => {
  for (const row of [
    "- The compiler printed the wrong diagnostic category; it now uses the configured category.",
    "- A configured await warning was reported as an error; warning overrides now apply.",
    "- The compiler rejected a diagnostic override with a leading zero; lookup now preserves it."
  ]) assert.equal(internalRecord(row), false, row)
})
