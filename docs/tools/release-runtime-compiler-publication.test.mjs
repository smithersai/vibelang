import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const internalRecord = text => /\bruntime\s+packages?\s+(?:two\s+)?stock[-\s]+typescript\s+checks\b/i.test(
  text.replaceAll("`", "").replaceAll("\u2019", "").replaceAll("\x27", ""))
const notes = readFileSync(new URL("../user/src/setup/release-notes.md", import.meta.url), "utf8")
const version = JSON.parse(readFileSync(new URL("../../packages/compiler/package.json", import.meta.url), "utf8")).version

function unpublished() {
  const releases = notes.split(/^## /m).slice(1)
  const candidate = releases.findIndex(release => release.split("\n")[0].replace(/ \(unreleased\)$/, "") === version)
  assert.ok(candidate >= 0, "the candidate version has a release-notes section")
  return releases.slice(0, candidate + 1).join("\n")
}

test("publication omits the runtime stock-TypeScript test budget record", {
  skip: !process.env.VIBELANG_RELEASE_NOTES_FINAL
}, () => assert.equal(internalRecord(unpublished()), false, "remove the internal stock-TypeScript checks row"))

test("the publication guard recognizes test records across typography and wrapping", () => {
  let state = 0x110033
  for (let i = 0; i < 40; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const space = [" ", "\n", "  "][state % 3]
    const owner = (state & 1) ? "package\x27s" : "package\u2019s"
    const words = ["runtime", owner, "two", "stock-TypeScript", "checks"].map((word, n) => {
      const text = (state >>> n) & 1 ? word.toUpperCase() : word
      return (state >>> (n + 3)) & 1 ? "`" + text + "`" : text
    })
    assert.equal(internalRecord("- The " + words.join(space) + " could time out; their compile budget is now longer."), true)
  }
})

test("the guard retains runtime declaration and stock-TypeScript product fixes", () => {
  for (const row of [
    "- The runtime package emitted declarations stock TypeScript could not resolve; the declarations now resolve.",
    "- Stock TypeScript rejected a runtime helper type; the helper now preserves its requirement.",
    "- A runtime call could hang while its compiler was starting; startup now completes."
  ]) assert.equal(internalRecord(row), false, row)
})
