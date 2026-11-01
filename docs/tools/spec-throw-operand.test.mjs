import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { test } from "node:test"
import ts from "typescript"
import { read } from "./spec-witness.mjs"

// Loop round 4, OPUS-4 and ASTRA-1: JavaScript has a `throw` statement, not a
// throw expression, and no VIP adds one; Appendix A admits `throw` as an
// expression only as a `match` arm body (`ArmBody`). VIP-39's clash table once
// showed `x ?? throw <E/>`. The scan covers the operand positions around the
// one witness: after `??`, `||`, `&&`, `?`, `=>`, `,`, `(`, `[` and `=`.
const operandThrow = /(\?\?|\|\||&&|=>|(?<![?.])\?(?![?.])|,|\(|\[|(?<![=!<>])=(?![=>]))\s*throw\b/

function codeOf(text) {
  const fences = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(m => m[1])
  const prose = text.replace(/```[^\n]*\n[\s\S]*?```/g, "")
  // A span the text calls "not VibeLang" is a counterexample, not a use.
  const spans = [...prose.matchAll(/`([^`\n]+)`(?! is not VibeLang)/g)].map(m => m[1])
  return [...fences.flatMap(f => f.split("\n")), ...spans]
}

const files = [
  ...readdirSync(new URL("../design/src", import.meta.url)).filter(f => f.endsWith(".md")).map(f => `docs/design/src/${f}`),
  ...readdirSync(new URL("../design/vips", import.meta.url)).filter(f => /^\d{4}-.*\.md$/.test(f)).map(f => `docs/design/vips/${f}`),
]

test("no chapter or VIP writes throw as an expression operand", () => {
  const hits = []
  for (const file of files) {
    for (const code of codeOf(read(file))) {
      if (operandThrow.test(code)) hits.push(`${file}: ${code.trim()}`)
    }
  }
  assert.deepEqual(hits, [])
})

test("VIP-39 row 4 keeps the throw statement and the do-block repair", () => {
  const row = read("docs/design/vips/0039-vibex.md").split("\n").find(l => l.startsWith("| 4 |"))
  assert.ok(row.includes("`throw <A/>` is JavaScript's `throw` statement, whose operand is an `Expression`"))
  assert.ok(row.includes("`x ?? throw <E/>` is not VibeLang (TS 5.9: TS1109); in effect code write `x ?? do { throw <E/> }` (VIP-2)"))
})

function syntax(source) {
  const file = ts.createSourceFile("witness.tsx", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
  return file.parseDiagnostics.map(d => d.code)
}

test("TypeScript's .tsx parser agrees: a throw statement takes JSX, a throw operand is TS1109", () => {
  assert.deepEqual(syntax("declare const E: any\nfunction f(x: unknown) { return x ?? throw <E/> }"), [1109])
  assert.deepEqual(syntax("declare const E: any\nfunction f(x: unknown) { return x || throw <E/> }"), [1109])
  assert.deepEqual(syntax("declare const E: any\nfunction f() { throw <E/> }"), [])
  assert.deepEqual(syntax("declare const E: any\nasync function f() { await <E/> }"), [])
  assert.deepEqual(syntax("declare const E: any\nfunction f(x: unknown) { return x ?? (() => { throw <E/> })() }"), [])
})
