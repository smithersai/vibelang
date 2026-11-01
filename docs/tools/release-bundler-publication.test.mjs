import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const internalRecord = text => /\bbundler\s+teardown\s+tests\b/i.test(text.replaceAll("`", " "))
const notes = readFileSync(new URL("../user/src/setup/release-notes.md", import.meta.url), "utf8")
const version = JSON.parse(readFileSync(new URL("../../packages/compiler/package.json", import.meta.url), "utf8")).version

function unpublished() {
  const releases = notes.split(/^## /m).slice(1)
  const candidate = releases.findIndex(release => release.split("\n")[0].replace(/ \(unreleased\)$/, "") === version)
  assert.ok(candidate >= 0, "the candidate version has a release-notes section")
  return releases.slice(0, candidate + 1).join("\n")
}

test("publication omits the bundler teardown test fixture record", {
  skip: !process.env.VIBELANG_RELEASE_NOTES_FINAL
}, () => assert.equal(internalRecord(unpublished()), false, "remove the internal bundler teardown tests row"))

test("the publication guard recognizes wrapped and code-formatted test records", () => {
  let state = 0x110030
  for (let i = 0; i < 40; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const space = [" ", "\n", "  "][state % 3]
    const words = ["bundler", "teardown", "tests"].map((word, n) => {
      const text = (state >>> n) & 1 ? word.toUpperCase() : word
      return (state >>> (n + 3)) & 1 ? "`" + text + "`" : text
    })
    assert.equal(internalRecord("- On a loaded host, the " + words.join(space) + " could fail; their fixture now controls the timer."), true)
  }
})

test("the guard retains public compiler and bundler teardown fixes", () => {
  for (const row of [
    "- Bundler teardown could leave a compiler alive; closeBundle now waits for it.",
    "- Tests that import VibeLang sources could not load them; the loader now resolves those modules.",
    "- The compiler could hang after a bundle failed; it now closes its inherited pipes."
  ]) assert.equal(internalRecord(row), false, row)
})
