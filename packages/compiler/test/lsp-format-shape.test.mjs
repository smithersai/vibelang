import { test } from "node:test"
import assert from "node:assert/strict"
import fc from "fast-check"
import { hasWithSpanEffectBlock } from "../../../typescript/vibelang/lsp-format-shape.mjs"

// The fixture's oracle is withSpan(effect { return try greeting() }, "load"):
// whitespace and trailing commas preserve that call, its program and its arguments.
test("LSP smoke accepts multiline effect-block arguments", () => {
  const formatted = 'return try withSpan(\n  effect {\n    return try greeting()\n  },\n  "load",\n)'
  assert.equal(hasWithSpanEffectBlock(formatted), true)
})

test("LSP smoke preserves the exact call under whitespace mutations", () => {
  const whitespace = fc.constantFrom("", " ", "\n", "\r\n", "\t", "  ")
  fc.assert(fc.property(fc.array(whitespace, { minLength: 10, maxLength: 10 }), fc.boolean(), fc.boolean(),
    (w, trailingComma, semicolon) => {
      const formatted = 'return try withSpan' + w[0] + '(' + w[1] + 'effect' + w[2].replace(/[\r\n]/g, ' ') +
        '{' + w[3] + 'return try greeting' + w[4] + '(' + w[5] + ')' + (semicolon ? ';' : '') + w[6] +
        '}' + w[7] + ',' + w[8] + '"load"' + (trailingComma ? ',' : '') + w[9] + ')'
      assert.equal(hasWithSpanEffectBlock(formatted), true)
      for (const rejected of [
        formatted.replace('effect', '() =>'),
        formatted.replace('effect', 'effect\n'),
        formatted.replace('return try withSpan', 'return\ntry withSpan'),
        formatted.replace('return try greeting', 'return\ntry greeting'),
        formatted.replace('return try greeting', 'return greeting'),
        formatted.replace('return try withSpan', 'return withSpan'),
        formatted.replace('withSpan', 'otherSpan'),
        formatted.replace('greeting', 'otherGreeting'),
        formatted.replace('"load"', '"other"'),
      ]) assert.equal(hasWithSpanEffectBlock(rejected), false, rejected)
    }), { numRuns: 200 })
})

test("LSP smoke rejects a call with the program and name swapped", () => {
  assert.equal(hasWithSpanEffectBlock('return try withSpan("load", effect { return try greeting() })'), false)
})

// Retain the exact witnesses from rejected vibex-lsp stack 2d25f8bf0bea here,
// beside the shared guard, rather than adding another predicate to lsp-smoke.mjs.
test("LSP smoke retains the recovered compact and wrapped effect-block witnesses", () => {
  for (const valid of [
    'return try withSpan(effect { return try greeting() }, "load")',
    'return try withSpan(\n  effect {\n    return try greeting();\n  },\n  "load",\n)'
  ]) assert.equal(hasWithSpanEffectBlock(valid), true, valid)
  for (const invalid of [
    'return try withSpan(effect () => greeting(), "load")',
    'return try withSpan(effect { return greeting() }, "load")',
    'return try withSpan(effect { return try greeting() }, "other")',
    'return\ntry withSpan(effect { return try greeting() }, "load")',
    'return try withSpan(effect\n{ return try greeting() }, "load")',
    'return try withSpan(effect { return\ntry greeting() }, "load")'
  ]) assert.equal(hasWithSpanEffectBlock(invalid), false, invalid)
})
