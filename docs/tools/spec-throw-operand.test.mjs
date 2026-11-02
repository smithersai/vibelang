import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { test } from "node:test"
import ts from "typescript"
import { read } from "./spec-witness.mjs"

// Throw expressions follow the TC39 throw-expressions proposal (decided detail
// 284; Will, 2026-11-02: "Refer to tc39 spec for answer"). Loop round 4 had
// pinned the opposite (no throw operand anywhere); loop round 15 ASTRA-1 found
// VIP-39 row 4 still saying `x ?? throw <E/>` "is not VibeLang". The rule now:
// a chapter or VIP may write a throw expression only where it cites the
// proposal (VIP-40 or the pinned TC39 repository), so an operand-position
// `throw` never appears as an unexplained form. The scan covers the operand
// positions around the witness: after `??`, `||`, `&&`, `?`, `=>`, `,`,
// `(`, `[`, `=` and `return`.
const operandThrow = /(\?\?|\|\||&&|=>|(?<![?.])\?(?![?.])|,|\(|\[|(?<![=!<>])=(?![=>])|\breturn)\s*throw\b/
const citation = /proposal-throw-expressions|0040-throw-expressions|VIP-40/

function codeOf(text) {
  const fences = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(m => m[1])
  const prose = text.replace(/```[^\n]*\n[\s\S]*?```/g, "")
  const spans = [...prose.matchAll(/`([^`\n]+)`/g)].map(m => m[1])
  return [...fences.flatMap(f => f.split("\n")), ...spans]
}

export function uncitedThrowOperands(text) {
  if (citation.test(text)) return []
  return codeOf(text).filter(code => operandThrow.test(code)).map(code => code.trim())
}

const files = [
  ...readdirSync(new URL("../design/src", import.meta.url)).filter(f => f.endsWith(".md")).map(f => `docs/design/src/${f}`),
  ...readdirSync(new URL("../design/vips", import.meta.url)).filter(f => /^\d{4}-.*\.md$/.test(f)).map(f => `docs/design/vips/${f}`),
]

test("a chapter or VIP writes a throw expression only beside the TC39 proposal it follows", () => {
  const hits = files.flatMap(file => uncitedThrowOperands(read(file)).map(code => `${file}: ${code}`))
  assert.deepEqual(hits, [])
})

// Neighbourhood of the round-15 witness: every operand position crossed with
// operand shapes, in a fence and in a prose span, with and without the
// citation. Only the uncited variants may be flagged; a throw statement never is.
test("the throw-operand check flags every uncited operand position and nothing else", () => {
  const positions = ["x ?? ", "x || ", "x && ", "c ? ", "() => ", "f(a, ", "f(", "[", "const y = ", "return "]
  const operands = ["e", "new E()", "<E/>", "await p", "(a, b)"]
  for (const at of positions) {
    for (const operand of operands) {
      const code = `${at}throw ${operand}`
      for (const doc of ["```vibe\n" + code + "\n```\n", "Write `" + code + "` here.\n"]) {
        assert.deepEqual(uncitedThrowOperands(doc), [code], doc)
        assert.deepEqual(uncitedThrowOperands(doc + "See [VIP-40](0040-throw-expressions.md).\n"), [], doc)
        assert.deepEqual(uncitedThrowOperands(doc + "See https://github.com/tc39/proposal-throw-expressions.\n"), [], doc)
      }
      assert.deepEqual(uncitedThrowOperands("```vibe\nthrow " + operand + "\n```\n"), [], operand)
    }
  }
})

test("VIP-39 row 4 admits the throw expression and keeps throw placement", () => {
  const row = read("docs/design/vips/0039-vibex.md").split("\n").find(l => l.startsWith("| 4 |"))
  assert.ok(row.includes("`throw <A/>` is JavaScript's `throw` statement, whose operand is an `Expression`"))
  assert.ok(row.includes("`x ?? throw <E/>` is a throw expression"))
  assert.ok(row.includes("its operand is a `UnaryExpression`, so `<` starts JSX there too"))
  assert.ok(row.includes("It is allowed where a throw statement is"))
  assert.ok(row.includes("`EK0401`"))
  assert.ok(!row.includes("not VibeLang"), "the round-4 prohibition is superseded by decided detail 284")
  assert.ok(!row.includes("x ?? do { throw <E/> }"), "the do-block rewrite is no longer required")
})

function syntax(source) {
  const file = ts.createSourceFile("witness.tsx", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
  return file.parseDiagnostics.map(d => d.code)
}

// Control: stock TypeScript does not implement the proposal, so TS1109 on a
// throw operand shows the proposal adds syntax; it is not evidence that
// VibeLang rejects it. The statement and `await` forms show `<` starts JSX.
test("TypeScript's .tsx parser: a throw statement takes JSX; the throw expression is syntax TypeScript lacks", () => {
  assert.deepEqual(syntax("declare const E: any\nfunction f(x: unknown) { return x ?? throw <E/> }"), [1109])
  assert.deepEqual(syntax("declare const E: any\nfunction f(x: unknown) { return x || throw <E/> }"), [1109])
  assert.deepEqual(syntax("declare const E: any\nfunction f() { throw <E/> }"), [])
  assert.deepEqual(syntax("declare const E: any\nasync function f() { await <E/> }"), [])
  assert.deepEqual(syntax("declare const E: any\nfunction f(x: unknown) { return x ?? (() => { throw <E/> })() }"), [])
})
