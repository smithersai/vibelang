import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { parseFixOutput } from "../lib/codemod.mjs"
import { assertFinished } from "../lib/diagnostics.mjs"
const fc = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-refused-site-receipts.json", import.meta.url), "utf8"))
test("safe independent fixes keep the compiler's refused byte-span receipt", () => {
  const parsed = parseFixOutput(corpus.output)
  assert.equal(parsed.total, 1)
  assert.deepEqual(parsed.refused, [corpus.refused])
  assert.doesNotThrow(() => assertFinished({ code: 0, stdout: corpus.output, stderr: "" }))
})
test("changed refused sites fail the flow even beside an ordinary compiler diagnostic", () => {
  const stdout = corpus.output.replace("refused site:", "refused site changed:") +
    "src/main.vibe(3,10): error EK2128: native return remains\n"
  assert.throws(() => assertFinished({ code: 3, stdout, stderr: "" }), /changed a refused site/)
})
test("refusal positions, byte offsets and new-site markers survive parser variations", () => {
  fc.assert(fc.property(fc.record({
    prefix: fc.constantFrom("", "λ\n", "😀\n", "before\r\n"),
    line: fc.integer({ min: 1, max: 100 }), column: fc.integer({ min: 1, max: 80 }),
    length: fc.integer({ min: 0, max: 50 }), newSite: fc.boolean(),
    newline: fc.constantFrom("\n", "\r\n"), code: fc.constantFrom("EK2128", "EK4836", "TS2322")
  }), input => {
    const start = Buffer.byteLength(input.prefix), end = start + input.length
    const message = "reason: keep the native statement"
    const output = "vibelang --fix: refused site: nested/main.vibe:" + input.line + ":" + input.column + "-" +
      input.line + ":" + (input.column + input.length) + " [" + start + "," + end + ") " + input.code +
      (input.newSite ? " new" : "") + ": " + message + input.newline
    const parsed = parseFixOutput(output)
    assert.deepEqual(parsed.refused, [{
      file: "nested/main.vibe", line: input.line, column: input.column,
      endLine: input.line, endColumn: input.column + input.length, start, end, code: input.code,
      ...(input.newSite ? { newSite: true } : {}), error: message
    }])
    assert.equal(parseFixOutput(output.replace("refused site:", "refused site changed:")).refused.length, 0)
  }), { seed: 393, numRuns: 40 })
})
