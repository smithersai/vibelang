import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { marked } from "marked"
import { SpecPath } from "../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const quote = "a variant named `$is` or `$match`, generic data included; rename it and its resolved references to a fresh name"

function diagnosticRows(text, code) {
  const found = []
  marked.walkTokens(marked.lexer(text), (token) => {
    if (token.type !== "table") return
    for (const row of token.rows) {
      if (row.some((cell) => cell.tokens?.some((item) => item.type === "codespan" && item.text === code))) found.push(row)
    }
  })
  return found
}

test("OPUS-6: the reserved data variant diagnostic renders inside its table", () => {
  const chapter = readFileSync(SpecPath("006-data.md"), "utf8")
  assert.ok(chapter.includes(quote), "update the quoted reserved-variant rule")
  const rows = diagnosticRows(chapter, "EK1602")
  assert.equal(rows.length, 1, "EK1602 must be a rendered diagnostic row")
  assert.ok(rows[0].some((cell) => cell.text.includes(quote)))
})

test("diagnostic rows retain table membership and detect detached-row mutations", async () => {
  const corpus = JSON.parse(readFileSync(new URL("./property-regressions/opus6-rendered-diagnostic-row.json", import.meta.url), "utf8"))
  assert.equal(diagnosticRows(corpus.before, "EK1602").length, 0)
  assert.equal(diagnosticRows(corpus.after, "EK1602").length, 1)
  await checkProperty(fc, {
    name: "RenderedDiagnosticRows",
    rule: "Chapter 6 quotes EK1602 as a table rule; GFM tables contain adjacent rows, and paragraphs or fences terminate them.",
    command: "node --test docs/tools/diagnostic-tables.property.test.mjs",
    arbitrary: fc.record({
      alignment: fc.constantFrom("---", ":---", "---:", ":---:"),
      blanks: fc.integer({ min: 1, max: 3 }),
      heading: fc.integer({ min: 1, max: 6 }),
      neighbours: fc.integer({ min: 0, max: 5 }),
      description: fc.constantFrom("a reserved variant", "a field named `_tag`", "the union `A\\|B`", "a generic `D<A>`")
    }),
    numRuns: 300,
    check(input) {
      const header = "| Rule | Diagnostic |\n| " + input.alignment + " | " + input.alignment + " |\n"
      const rows = Array.from({ length: input.neighbours }, (_, i) => "| ordinary " + i + " | `EK" + (1000 + i) + "` |").join("\n")
      const target = "| " + input.description + " | `EK1602` |"
      const separator = "\n".repeat(input.blanks + 1)
      const prefix = "#".repeat(input.heading) + " Diagnostics" + separator
      const interruption = separator + "A separate example." + separator + "```ts\nconst value = 1\n```" + separator
      const joined = prefix + header + (rows ? rows + "\n" : "") + target + "\n"
      const detached = prefix + header + rows + interruption + target + "\n"
      assert.equal(diagnosticRows(joined, "EK1602").length, 1)
      assert.equal(diagnosticRows(detached, "EK1602").length, 0)
    }
  })
})
