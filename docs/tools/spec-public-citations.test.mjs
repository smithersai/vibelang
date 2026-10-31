import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read } from "./spec-witness.mjs"

// The decision log is not part of the repository, so a public chapter cites the
// accepted VIP amendment that records a rule, not a decided-detail number.
const citations = text => [...text.matchAll(/decided details? [0-9][^)]*/g)].map(m => m[0])

test("the introduction cites no decided detail", () => {
  assert.deepEqual(citations(chapter("000-intro")), [])
})

test("each rule the introduction cites is in the amendment it names", () => {
  const intro = chapter("000-intro")
  const vip7 = read("docs/design/vips/0007-match.md")
  const vip38 = read("docs/design/vips/0038-effect-lint-built-in.md")
  assert.match(intro, /including static call and construct signatures \(VIP-7, amended\)/)
  assert.match(vip7, /\*\*Amended 2026-10-29: a class pattern naming a non-class callable dispatches on its static signatures\.\*\*/)
  assert.match(intro, /`HttpClientError\.isHttpClientError`; VIP-7, amended\)/)
  assert.match(vip7, /\*\*Amended 2026-10-29: subpath tagged errors\.\*\* The retained tagged-error checks cover every public `effect\/…` module/)
  assert.match(intro, /prints a stable `EK38xx` code \(VIP-38, amended\)/)
  assert.match(vip38, /\*\*Amended 2026-10-29: codes for the imported rules\.\*\* Each imported `effecttsgo\/\*` rule gets one stable `EK38xx` code/)
})
