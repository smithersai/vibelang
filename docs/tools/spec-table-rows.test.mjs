import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { test } from "node:test"
import { chapter } from "./spec-witness.mjs"
import { tableRowProblems } from "./table-rows.mjs"

// Loop round 1, OPUS-6: chapter 6's EK1602 row once sat alone after a code
// fence, so Markdown rendered it as text and the chapter's diagnostic table
// lost the code. Every line that starts with `|` outside a fenced block must
// belong to a table: a header row, a delimiter row, then rows, each with the
// header's cell count.
test("every table row in the specification belongs to a table", () => {
  const problems = []
  for (const file of readdirSync(new URL("../design/src/", import.meta.url)).filter(f => f.endsWith(".md"))) {
    problems.push(...tableRowProblems(chapter(file.replace(/\.md$/, "")), file))
  }
  assert.deepEqual(problems, [])
})

test("chapter 6's diagnostics table lists EK1602 between EK1601 and EK1603", () => {
  const data = chapter("006-data")
  const rows = data.split("\n").filter((line) => /^\| .*\| `EK160[123]` \|$/.test(line))
  assert.deepEqual(rows.map((row) => row.match(/`(EK160\d)`/)[1]), ["EK1601", "EK1602", "EK1603"])
})
