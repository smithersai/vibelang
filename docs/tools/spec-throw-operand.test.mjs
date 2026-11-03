import { createHash } from "node:crypto"
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
// proposal (VIP-41 or the pinned TC39 repository), so an operand-position
// `throw` never appears as an unexplained form. The scan covers the operand
// positions around the witness: after `??`, `||`, `&&`, `?`, `=>`, `,`,
// `(`, `[`, `=` and `return`.
const operandThrow = /(\?\?|\|\||&&|=>|(?<![?.])\?(?![?.])|,|\(|\[|(?<![=!<>])=(?![=>])|\breturn)\s*throw\b/
const citation = /proposal-throw-expressions|0041-throw-expressions|VIP-41/

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
        assert.deepEqual(uncitedThrowOperands(doc + "See [VIP-41](0041-throw-expressions.md).\n"), [], doc)
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

// VIP-41 adopts the pinned proposal; native TypeScript is a boundary check,
// not the oracle for VibeLang's additional unary production.
test("VIP-41 imports the pinned throw grammar and its exact lookahead", () => {
  const spec = read("docs/design/vips/tc39-throw-expressions/spec.emu")
  assert.equal(createHash("sha256").update(spec).digest("hex"), "0e5c16ceac81cd88d1ad0c0d8bfb4d28cda4a1d6726d31e081b286b1e4eaab47")
  const appendix = read("docs/design/src/900-appendices.md")
  assert.match(appendix, /"throw" UnaryExpression\[\?Yield, \?Await\] \[lookahead ∉ ThrowExpressionInvalidPunctuator\]/)
  const tick = String.fromCharCode(96)
  const tokens = new RegExp(tick + "([^" + tick + "]+)" + tick, "g")
  const upstream = spec.match(/ThrowExpressionInvalidPunctuator : one of ([^\n]+)/)
  assert.ok(upstream)
  const decode = (s) => s.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")
  const expected = [...upstream[1].matchAll(tokens)].map(m => decode(m[1]))
  const production = appendix.split("ThrowExpressionInvalidPunctuator = ")[1]?.split("ExpressionStatement[")[0]
  assert.ok(production)
  assert.deepEqual([...production.matchAll(/"([^"]+)"/g)].map(m => m[1]), expected)
  assert.equal(expected.length, 41)
  assert.ok(appendix.includes("ECMAScript automatic semicolon insertion applies."))
})

