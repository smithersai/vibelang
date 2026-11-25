import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { SpecPath } from "../../scripts/testing/spec-path.mjs"

test("Chapter 001 allows only the generated VIP-27 contract difference", () => {
  const chapter = readFileSync(SpecPath("001-functions.md"), "utf8")
  assert.ok(chapter.includes("Compare the ordinary stock-`tsc` twin without adding generated tags to it."))
  assert.ok(chapter.includes("Authored throw tags must remain unchanged."))
})

