import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

for (const page of ["014-expected-errors", "024-yieldable-errors"]) {
  test(page + " describes the runnable syntax as available", () => {
    const text = readFileSync(new URL("../user/src/error-management/" + page + ".md", import.meta.url), "utf8")
    assert.ok(!text.includes("Support for the new forms arrives"), "the guide's working forms are already implemented")
  })
}
