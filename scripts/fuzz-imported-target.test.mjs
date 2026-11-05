import assert from "node:assert/strict"
import { test } from "node:test"
import { fuzzTopics } from "../fuzz-topics.ts"

test("the imported lint topic retains its eligibility generator and quoted oracle", () => {
  const imported = fuzzTopics.get("imported") ?? []
  assert.ok(imported.includes("FuzzImportedLintEligibility"), "selected-input eligibility needs its source/configuration generator")
  assert.ok(imported.includes("TestImportedLintEligibilityQuoted"), "selected-input eligibility needs its quoted rule oracle")
})
