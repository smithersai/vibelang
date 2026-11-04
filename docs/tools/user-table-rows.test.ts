import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { lexer } from "marked"
import fc from "fast-check"
import { tableRowProblems, userTableProblems } from "./table-rows.mjs"

test("every user-docs table row follows a header and delimiter", () => {
  expect(userTableProblems()).toEqual([])
})

test("tracing is a migration body row, not the table header", () => {
  const text = readFileSync(new URL("../user/src/setup/release-notes.md", import.meta.url), "utf8")
  const table = lexer(text).find(t => t.type === "table" && t.rows.some(row => row[0].text.includes("vibelang.tracing")))
  expect(table?.type).toBe("table")
  if (table?.type !== "table") return
  expect(table.header.map(cell => cell.text)).toEqual(["Before", "After and repair"])
})

test("rows inserted above the delimiter cannot replace headers silently", () => {
  fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 99999 }), { minLength: 1, maxLength: 5 }), values => {
    const header = "| Before | After and repair |", delimiter = "| --- | --- |"
    const rows = values.map(n => "| old" + n + " | new" + n + " |")
    const valid = [header, delimiter, ...rows].join("\n")
    const broken = [header, rows[0], delimiter, ...rows.slice(1)].join("\n")
    expect(tableRowProblems(valid, "generated")).toEqual([])
    expect(tableRowProblems(broken, "generated")).toHaveLength(1)
    const table = lexer(valid).find(t => t.type === "table")
    expect(table?.type === "table" && table.rows.length).toBe(rows.length)
  }), { numRuns: 200, seed: 110426 })
})

test("fenced examples do not become document tables", () => {
  for (const fence of [String.fromCharCode(96).repeat(3), "~~~~"]) {
    expect(tableRowProblems(fence + "txt\n| not a table |\n" + fence, "example")).toEqual([])
  }
})
