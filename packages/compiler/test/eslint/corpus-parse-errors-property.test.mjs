import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { Linter } from "eslint"
import vibelang from "../../eslint.mjs"
import { repo } from "./helpers.mjs"
import { expectedParseError, matchesLintParseError } from "./helpers.mjs"

const files = ["typescript/vibelang/cases/fiber-unary-exponentiation-error/main.vibe", "typescript/vibelang/lsp-fixture/src/malformed-pipe.vibe"]

test("real ESLint fatal reports match only the named fixture and intended source position", () => {
  fc.assert(fc.property(fc.constantFrom(...files), fc.integer({ min: 0, max: 4 }), (file, shift) => {
    const filename = repo + file
    const linter = new Linter({ configType: "flat", cwd: "/" })
    const messages = linter.verify("\n".repeat(shift) + readFileSync(filename, "utf8"), [
      { files: ["**/*.vibe"], languageOptions: { parser: vibelang } }
    ], { filename })
    assert.equal(messages.length, 1, JSON.stringify(messages))
    const [message] = messages
    assert.equal(message.fatal, true)
    const expected = expectedParseError(filename)
    assert.equal(matchesLintParseError(expected, message), shift === 0)
    assert.equal(matchesLintParseError(expectedParseError(filename.replace(".vibe", "-neighbour.vibe")), message), false)
    assert.equal(matchesLintParseError(expected, { ...message, message: message.message + "changed" }), false)
    assert.equal(matchesLintParseError(expected, { ...message, column: message.column + 1 }), false)
    assert.equal(matchesLintParseError(expected, { ...message, fatal: false }), false)
  }), { seed: 103, numRuns: 100 })
})
