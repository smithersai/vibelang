import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read } from "./spec-witness.mjs"

test("the public specification and VIP index name the same accepted amendment chain", () => {
  for (const text of [chapter("000-intro"), read("docs/design/vips/README.md")]) {
    const opening = text.split("\n\n")[1]
    assert.match(opening, /public amendments/)
    assert.match(opening, /authorized clarifications/i)
    assert.match(opening, /affected chapter/)
    assert.doesNotMatch(opening, /applicable ruling or decided detail/)
  }
})

test("the authority link resolves to public accepted VIPs and keeps history nonnormative", () => {
  assert.match(chapter("000-intro"), /\[.*\]\(\.\.\/vips\/README\.md\)/)
  const index = read("docs/design/vips/README.md")
  for (const path of ["0001-effect-and-async-functions.md", "0005-try-runs-effects.md"]) {
    assert.ok(index.includes(`](${path})`))
    assert.match(read("docs/design/vips/" + path), /\*\*Status:\*\* accepted/)
  }
  assert.match(chapter("000-intro"), /historical and not normative/)
})
