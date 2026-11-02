// Runs in compiler-test without optional ESLint packages.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { parseESTree } from "../eslint.mjs"
import { expectedParseError, matchesParseError, matchesLintParseError } from "./eslint/helpers.mjs"

const files = ["typescript/vibelang/cases/fiber-unary-exponentiation-error/main.vibe", "typescript/vibelang/lsp-fixture/src/malformed-pipe.vibe"]
const filename = (file) => new URL("../../../" + file, import.meta.url).pathname
function failure(code, file) {
  try { parseESTree(code, file) }
  catch (error) { return error }
  assert.fail("the deliberate syntax-error fixture unexpectedly parsed")
}

test("both named fixtures still produce their intended native syntax error", () => {
  for (const file of files) {
    const path = filename(file)
    const expected = expectedParseError(path)
    assert.ok(expected, file)
    const error = failure(readFileSync(path, "utf8"), path)
    assert.equal(matchesParseError(expected, error), true)
    assert.equal(matchesParseError(expected, new Error(expected.message)), false)
    assert.equal(matchesParseError(undefined, error), false)
    assert.equal(expectedParseError(path.replace(".vibe", "-neighbour.vibe")), undefined)
    const message = { message: "Parsing error: " + expected.message, fatal: true, ruleId: null, line: expected.line, column: expected.column }
    assert.equal(matchesLintParseError(expected, message), true)
    assert.equal(matchesLintParseError(expected, { ...message, fatal: false }), false)
    assert.equal(matchesLintParseError(expected, { ...message, ruleId: "source-rule" }), false)
  }
})

test("generated neighbouring positions and diagnostics never match an expected failure", () => {
  fc.assert(fc.property(fc.constantFrom(...files), fc.integer({ min: 0, max: 4 }), (file, shift) => {
    const path = filename(file)
    const expected = expectedParseError(path)
    const error = failure("\n".repeat(shift) + readFileSync(path, "utf8"), path)
    assert.equal(matchesParseError(expected, error), shift === 0)
    assert.equal(matchesParseError({ ...expected, message: expected.message + "changed" }, error), false)
    assert.equal(matchesParseError({ ...expected, column: expected.column + 1 }, error), false)
    const message = { message: "Parsing error: " + error.message, fatal: true, ruleId: null, line: error.lineNumber, column: error.column }
    assert.equal(matchesLintParseError(expected, message), shift === 0)
  }), { seed: 103, numRuns: 100 })
})
