import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

test("the repository root carries a non-empty LICENSE", () => {
  const license = readFileSync(new URL("../LICENSE", import.meta.url), "utf8")
  assert.ok(license.trim().length > 0)
})
