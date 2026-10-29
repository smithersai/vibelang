import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
test("diagnostic reference covers registered editor suggestions", () => {
  const source = readFileSync(new URL("../../typescript/tsc/internal/vibelang/lsrules_fixes.go", import.meta.url), "utf8")
  const docs = readFileSync(new URL("../design/history/src/428-part4-ch28-tooling.md", import.meta.url), "utf8")
  for (const [, code] of source.matchAll(/var EK(91\d+) = message/g)) {
    assert.ok(docs.includes(`| EK${code} |`), `missing EK${code}`)
  }
  const row = docs.split("\n").find(line => line.startsWith("| EK9101 |"))
  assert.match(row, /editor-only/)
  assert.match(row, /receiver/)
  assert.match(row, /Annotate as the fork infers/)
})
