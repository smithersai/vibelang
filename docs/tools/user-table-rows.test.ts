import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { lexer } from "marked"
import fc from "fast-check"
import { tableRowProblems, userTableProblems } from "./table-rows.mjs"

test("every user-docs table row follows its header, delimiter and width", () => {
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

test("diagnostic descriptions render in the reference table, outside the renumberings", () => {
  const text = readFileSync(new URL("../user/src/vibelang-features/diagnostic-code-map.md", import.meta.url), "utf8")
  const tables = lexer(text).filter(token => token.type === "table")
  const reference = tables.find(table => table.header.map(cell => cell.text).join("|") === "Code|Rule")
  expect(reference).toBeDefined()
  for (const code of ["EK0201", "EK0202"]) {
    const marker = "`" + code + "`"
    const row = reference?.rows.find(row => row[0].text === marker)
    expect(row?.[1].text).toBeTruthy()
    for (const table of tables.filter(table => table.header[0].text === "Previous code")) {
      expect(table.rows.some(row => row[0].text === marker)).toBe(false)
    }
  }
})

test("user table widths reject missing and extra cells", () => {
  const root = mkdtempSync(join(tmpdir(), "user-table-widths-"))
  try {
    fc.assert(fc.property(
      fc.integer({ min: 2, max: 8 }), fc.nat(), fc.boolean(),
      (width, position, extra) => {
        const row = (cells: string[]) => "| " + cells.join(" | ") + " |"
        const header = Array.from({ length: width }, (_, n) => "Column " + n)
        const values = header.map((_, n) => "`value" + n + "`")
        const table = (body: string[]) => [row(header), row(header.map(() => "---")), row(body)].join("\n")
        const path = join(root, "table.md")
        writeFileSync(path, table(values))
        expect(userTableProblems(root)).toEqual([])
        const broken = [...values]
        if (extra) broken.splice(position % (width + 1), 0, "extra")
        else broken.splice(position % width, 1)
        writeFileSync(path, table(broken))
        expect(userTableProblems(root)).toHaveLength(1)
      }
    ), { numRuns: 200, seed: 20402 })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
