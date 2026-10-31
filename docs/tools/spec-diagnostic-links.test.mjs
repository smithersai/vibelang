import assert from "node:assert/strict"
import test from "node:test"
import { chapter } from "./spec-witness.mjs"

// Each Appendix B row links the chapter section that defines its rule, so the
// linked section names the row's code.
const slug = heading => heading.trim().toLowerCase().replaceAll("`", "").replace(/[^\w\- ]/g, "").replaceAll(" ", "-")

function section(text, anchor) {
  const lines = text.split("\n")
  let fenced = false
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("```")) { fenced = !fenced; continue }
    const heading = fenced ? null : lines[i].match(/^(#+) (.+)$/)
    const named = heading && slug(heading[2]) === anchor
    if (!named && !lines[i].includes(`<a id="${anchor}"></a>`)) continue
    const level = named ? heading[1].length : 6
    let inner = false
    let j = i + 1
    for (; j < lines.length; j++) {
      if (lines[j].startsWith("```")) { inner = !inner; continue }
      const next = inner ? null : lines[j].match(/^(#+) /)
      if (next && next[1].length <= level) break
    }
    return lines.slice(i, j).join("\n")
  }
  return undefined
}

test("every Appendix B row links a section that names its code", () => {
  const rows = [...chapter("900-appendices").matchAll(/^\| `(EK\d+)` \|.*\]\((?:([0-9]{3}-[a-z-]+)\.md)?(?:#([^)]+))?\)/gm)]
  assert.ok(rows.length > 200, "Appendix B rows")
  const unnamed = []
  for (const [, code, file, anchor] of rows) {
    const name = file ?? "900-appendices"
    const text = chapter(name)
    const body = anchor ? section(text, anchor) : text
    assert.ok(body !== undefined, `${code}: ${name}#${anchor} does not exist`)
    if (!body.includes(code)) unnamed.push(`${code} -> ${name}#${anchor ?? ""}`)
  }
  assert.deepEqual(unnamed, [])
})
