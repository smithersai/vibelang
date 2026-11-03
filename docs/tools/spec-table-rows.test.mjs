import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { marked } from "marked"
import fc from "fast-check"
import { test } from "node:test"
import { chapter } from "./spec-witness.mjs"
import { tableRowProblems } from "./table-rows.mjs"

// Every row outside a fence must follow a table header and delimiter.
// GFM recognizes separators before inline code spans.
test("every table row in the specification belongs to a table", () => {
  const problems = []
  for (const dir of ["src", "vips"]) {
    for (const name of readdirSync(new URL("../design/" + dir + "/", import.meta.url)).filter(f => f.endsWith(".md"))) {
      const file = dir + "/" + name
      problems.push(...tableRowProblems(readFileSync(new URL("../design/" + file, import.meta.url), "utf8"), file))
    }
  }
  assert.deepEqual(problems, [])
})

test("chapter 6's diagnostics table lists EK1602 between EK1601 and EK1603", () => {
  const data = chapter("006-data")
  const rows = data.split("\n").filter((line) => /^\| .*\| `EK160[123]` \|$/.test(line))
  assert.deepEqual(rows.map((row) => row.match(/`(EK160\d)`/)[1]), ["EK1601", "EK1602", "EK1603"])
})

test("union pipes inside code spans must be escaped before Markdown table parsing", () => {
  const quote = String.fromCharCode(96)
  const broken = "| " + quote + "T | undefined" + quote + " | value |"
  const repaired = broken.replace("T |", "T \\|")
  const source = row => "| Source | Mapping |\n| --- | --- |\n" + row
  assert.deepEqual(tableRowProblems(source(broken), "generated"),
    ["generated:3: 3 cells, the header has 2"])
  assert.deepEqual(tableRowProblems(source(repaired), "generated"), [])
  const render = row => marked.lexer(source(row))[0].rows[0].map(c => c.text)
  assert.deepEqual(render(broken), [quote + "T", "undefined" + quote])
  assert.deepEqual(render(repaired), [quote + "T | undefined" + quote, "value"])
})

test("generated code-span unions retain all mappings only with escaped separators", () => {
  fc.assert(fc.property(fc.array(fc.constantFrom("A", "B", "undefined", "null", "never"), { minLength: 2, maxLength: 8 }), terms => {
    const quote = String.fromCharCode(96)
    const source = terms.join(" | ")
    const row = "| " + quote + source.replaceAll("|", "\\|") + quote + " | decoded | encoded |"
    const header = "| Source | Type | Encoded |\n| --- | --- | --- |\n"
    assert.deepEqual(tableRowProblems(header + row, "generated"), [])
    const table = marked.lexer(header + row)[0]
    assert.deepEqual(table.rows[0].map(c => c.text), [quote + source + quote, "decoded", "encoded"])
    assert.deepEqual(tableRowProblems(header + row.replaceAll("\\|", "|"), "generated"),
      ["generated:3: " + (terms.length + 2) + " cells, the header has 3"])
  }), { seed: 19002, numRuns: 200 })
})
