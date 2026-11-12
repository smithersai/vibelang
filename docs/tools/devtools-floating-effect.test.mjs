import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

// A discarded Effect is EK4801 when the project has no @effect/language-service
// plugin, the starter's default, and EK3801 (Effect's floatingEffect) with it.
// The rule table must give both, or a reader of the default setup looks up the wrong code.
test("the floatingEffect row names the code a discarded Effect reports with and without the plugin", () => {
  const page = readFileSync(new URL("../user/src/getting-started/012-devtools.md", import.meta.url), "utf8")
  const row = page.split("\n").find(line => line.startsWith("| Correctness | `floatingEffect` |"))
  assert.ok(row, "the rule table keeps its floatingEffect row")
  assert.match(row, /`EK3801`[^|]*with the `@effect\/language-service` plugin/)
  assert.match(row, /`EK4801`[^|]*without it/)
})
