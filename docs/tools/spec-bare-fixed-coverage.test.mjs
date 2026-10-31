import assert from "node:assert/strict"
import { test } from "node:test"
import { chapter, read } from "./spec-witness.mjs"

// Loop round 3, OPUS-6 (decided detail 78): a bare fixed pattern has no
// argument list, so the length clause cannot exclude it.
test("chapter 4 and VIP-7 say a bare fixed pattern covers its case", () => {
  const match = chapter("004-match")
  assert.ok(match.includes("covers its case when it is bare, or when its argument list has the required length"))
  assert.ok(match.includes("A bare pattern has no argument list, which is not an empty list"))
  assert.ok(match.includes("match (o) { when Option.Some: 1; when Option.None: 0; }"))
  assert.ok(read("docs/design/vips/0007-match.md").includes("a bare fixed pattern covers its case"))
})
