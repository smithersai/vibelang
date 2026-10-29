import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

test("formatter refusals distinguish rewritten clauses from native TypeScript", () => {
  const text = readFileSync(new URL("../user/src/setup/formatting.md", import.meta.url), "utf8")
  assert.match(text, /ordinary TypeScript `try`\/`catch`\/`finally` clauses are supported/)
  assert.doesNotMatch(text, /between two clauses of a `try` statement/)
})
