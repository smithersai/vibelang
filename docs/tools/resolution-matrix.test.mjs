import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { matrix } from "../../scripts/resolution-matrix.mjs"
test("the recorded resolution matrix equals every TypeScript 5.9.3 cell", () => {
  const recorded = JSON.parse(readFileSync(new URL("../design/resolution-matrix.json", import.meta.url)))
  assert.equal(recorded.rows.length, 448)
  assert.deepEqual(matrix(), recorded)
})

// A written source extension's lookup lists in 007-tooling.md and VIP-39 must
// include every sibling variant TypeScript 5.9.3 substitutes on the twin.
export function missingSubstitutions(rows, ...texts) {
  const missing = []
  for (const [form, written, sibling] of [["vibe-cross", "./App.vibe", "App.vibex"], ["vibex-cross", "./App.vibex", "App.vibe"]]) {
    if (!rows.some(r => r.form === form && r.resolved)) continue
    for (const text of texts) {
      const line = text.split("\n").find(l => l.startsWith("| `" + written + "` |"))
      if (!line || !line.includes("`" + sibling + "`")) missing.push(written + " lacks " + sibling)
    }
  }
  return missing
}
test("source-extension lookup tables list TypeScript's sibling substitution", () => {
  const recorded = JSON.parse(readFileSync(new URL("../design/resolution-matrix.json", import.meta.url)))
  const tooling = readFileSync(new URL("../design/src/007-tooling.md", import.meta.url), "utf8")
  const vip = readFileSync(new URL("../design/vips/0039-vibex.md", import.meta.url), "utf8")
  assert.deepEqual(missingSubstitutions(recorded.rows, tooling, vip), [])
  const stale = "| `./App.vibe` | `App.vibe`, `App.d.ts` |\n| `./App.vibex` | `App.vibex`, `App.d.ts` |"
  assert.deepEqual(missingSubstitutions(recorded.rows, stale),
    ["./App.vibe lacks App.vibex", "./App.vibex lacks App.vibe"])
})
