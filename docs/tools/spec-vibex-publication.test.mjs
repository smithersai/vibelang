import assert from "node:assert/strict"
import { test } from "node:test"
import { chapter, read } from "./spec-witness.mjs"

// Loop round 4, OPUS-2: VIP-39 was accepted with no chapter text. Every
// accepted VIP must appear in the introduction's chapter list, and the
// chapters that state a rule for `.vibe` files name `.vibex` beside it.
test("every accepted VIP is in some chapter of the introduction's list", () => {
  const accepted = [...read("docs/design/vips/README.md").matchAll(/^\| \[(\d+)\]\([^)]*\) \| [^\n]*\| accepted [^\n]*\|$/gm)].map(m => Number(m[1]))
  assert.ok(accepted.includes(39))
  const intro = chapter("000-intro")
  const list = intro.slice(intro.indexOf("## Chapters"))
  const listed = new Set()
  for (const m of list.matchAll(/VIP-(\d+)(?: to VIP-(\d+))?/g)) {
    for (let n = Number(m[1]); n <= Number(m[2] ?? m[1]); n++) listed.add(n)
  }
  assert.deepEqual(accepted.filter(n => !listed.has(n)), [])
})

test("the chapters name .vibex where they state a rule for .vibe files", () => {
  const functions = chapter("001-functions")
  assert.ok(functions.includes("Every source `.vibe` or `.vibex` file is classified as an external module"))
  assert.ok(functions.includes("and for each `x.vibex`, `x.d.vibex.ts` (VIP-27, VIP-39)"))
  const tooling = chapter("007-tooling")
  assert.ok(tooling.includes("[VIP-39](../vips/0039-vibex.md)"))
  assert.ok(tooling.includes("`.vibe` and `.vibex` are supported source extensions"))
  assert.ok(tooling.includes("`x.vibex` emits `x.jsx` under `\"jsx\": \"preserve\"` and `x.js` otherwise"))
  assert.ok(tooling.includes('<a id="vibex"></a>\n\n## JSX source files: `.vibex`'))
  assert.ok(chapter("000-intro").includes("| `x.vibex` | a `.vibe` file read with `.tsx`'s JSX language variant | 39 | [Configuration and tooling](007-tooling.md#vibex) |"))
  assert.ok(chapter("900-appendices").includes("a `.vibex` file uses these productions unchanged, read with TypeScript's JSX language variant ([VIP-39](../vips/0039-vibex.md) adds no production)"))
})

function table(text, after) {
  const from = text.indexOf(after)
  assert.ok(from >= 0, after)
  const rows = text.slice(from).split("\n").filter(l => l.startsWith("| `./"))
  const end = rows.findIndex((r, i) => i > 0 && r.startsWith("| `./App`"))
  return rows.slice(0, end < 0 ? 4 : end).slice(0, 4).map(r => r.replace(" (unchanged)", ""))
}

test("chapter 7's resolution table is VIP-39's", () => {
  const ours = table(chapter("007-tooling"), "## JSX source files: `.vibex`")
  const vip = table(read("docs/design/vips/0039-vibex.md"), "### Imports and resolution")
  assert.equal(ours.length, 4)
  assert.deepEqual(ours, vip)
})
