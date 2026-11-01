import assert from "node:assert/strict"
import { test } from "node:test"
import ts from "typescript"
import { read } from "./spec-witness.mjs"

// Loop round 4, OPUS-6: TypeScript's scanner reads `</` as one token under the
// JSX language variant wherever it stands, so `.vibex` text with `<` directly
// before a regular expression changes meaning. VIP-39 keeps the scanner
// (no new scanner mode), so the clash table lists it as row 39.
const vip = read("docs/design/vips/0039-vibex.md")

function tokens(text, variant) {
  const scanner = ts.createScanner(ts.ScriptTarget.ESNext, true, variant, text)
  const out = []
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) out.push(kind)
  return out
}

const lessSlash = (text, variant) => tokens(text, variant).includes(ts.SyntaxKind.LessThanSlashToken)

test("TypeScript's JSX scanner reads </ as one token outside a tag, unless /* starts a comment", () => {
  for (const text of ["a </b/.source.length", "when </b/: 1", "x is </b/", "a <//c\nb"]) {
    assert.ok(lessSlash(text, ts.LanguageVariant.JSX), text)
    assert.ok(!lessSlash(text, ts.LanguageVariant.Standard), text)
  }
  for (const text of ["a < /b/.source.length", "when < /b/: 1", "a </*c*/ b"]) assert.ok(!lessSlash(text, ts.LanguageVariant.JSX), text)
})

function syntax(source, kind) {
  return ts.createSourceFile("witness" + (kind === ts.ScriptKind.TSX ? ".tsx" : ".ts"), source, ts.ScriptTarget.ESNext, true, kind).parseDiagnostics.map(d => d.code)
}

test("so a < directly before a regular expression parses in .ts and not in .tsx", () => {
  const bad = "export const bad = (a: number) => a </b/.source.length\n"
  const good = "export const good = (a: number) => a < /b/.source.length\n"
  assert.deepEqual(syntax(bad, ts.ScriptKind.TS), [])
  assert.deepEqual(syntax(bad, ts.ScriptKind.TSX), [1005, 1005])
  assert.deepEqual(syntax(good, ts.ScriptKind.TSX), [])
})

test("VIP-39 lists the </ case as row 39 and counts it", () => {
  const rows = vip.split("\n").filter(l => /^\| \d+ \| /.test(l)).map(l => Number(l.split("|")[1]))
  const claimed = Number(vip.match(/Deduplicated to \*\*(\d+) rows\*\*/)[1])
  assert.equal(rows.length, claimed)
  assert.deepEqual([...rows].sort((a, b) => a - b), Array.from({ length: claimed }, (_, i) => i + 1))
  const row = vip.split("\n").find(l => l.startsWith("| 39 | "))
  assert.ok(row.includes("`a </b/.source.length`") && row.includes("`LessThanSlashToken`") && row.includes("write a space"))
  assert.ok(vip.includes("Rows 1–5 and 39 are the only places where `.vibe` text changes meaning in `.vibex`."))
  assert.ok(vip.includes("except that `</` is one token in every `.vibex` context (row 39): write `when < /re/:`."))
})
