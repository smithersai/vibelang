import { expect, test } from "bun:test"
import fc from "fast-check"
import { marked } from "marked"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

function emptyHeaders(markdown: string) {
  return marked.lexer(markdown).flatMap(token => token.type === "table"
    ? token.header.flatMap((cell, index) => cell.text.trim() ? [] : [index]) : [])
}
function table(headers: string[]) {
  return "|" + headers.join("|") + "|\n|" + headers.map(() => "---").join("|") + "|\n|" + headers.map(() => "value").join("|") + "|"
}
test("published proposal comparison tables name every column", () => {
  const root = join(import.meta.dir, "../design/vips")
  const files = readdirSync(root).filter(file => /^\d{4}-.+\.md$/.test(file))
  const missing = files.flatMap(file => emptyHeaders(readFileSync(join(root, file), "utf8")).map(column => ({ file, column })))
  expect(missing).toEqual([])
})
test("table header checks detect empty columns across generated comparisons", () => {
  fc.assert(fc.property(
    fc.array(fc.stringMatching(/^[A-Za-z]{1,12}$/), { minLength: 2, maxLength: 8 }),
    fc.nat(),
    (headers, value) => {
      expect(emptyHeaders(table(headers))).toEqual([])
      const missing = value % headers.length
      headers[missing] = " "
      expect(emptyHeaders(table(headers))).toEqual([missing])
    },
  ), { numRuns: 200 })
})
test("table header checks leave fenced examples alone", () => {
  fc.assert(fc.property(fc.integer({ min: 2, max: 8 }), count => {
    expect(emptyHeaders("~~~markdown\n" + table(Array(count).fill("")) + "\n~~~")).toEqual([])
  }), { numRuns: 100 })
})
