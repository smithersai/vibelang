import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { emitErrorsIn } from "../lib/declarations.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-mobile-inherited-emit.json", import.meta.url)))

test("t3code Mobile zero-source audit: inherited original errors do not add an emit-exit failure", () => {
  assert.deepEqual(emitErrorsIn(corpus.current.diagnostics, corpus.files, { code: corpus.current.code, baseline: corpus.baseline }), [])
  assert.ok(emitErrorsIn(corpus.current.diagnostics, corpus.files, { code: corpus.current.code }).length, "missing original evidence is not a waiver")
})

// Coordinator 09:47Z ruling: "a converted program fails only on emit diagnostics the original's program doesn't have."
// Count diagnostics by source identity, code, message and notes; locations can move during conversion.
test("inherited emit diagnostics preserve counts and reject every new diagnostic neighbourhood", () => {
  const diagnostic = fc.record({
    file: fc.constantFrom(null, "main.ts", "other.ts"), category: fc.constant("error"),
    code: fc.constantFrom("TS2883", "TS7056", "TS5023"), message: fc.string({ maxLength: 30 }),
    line: fc.nat({ max: 100 }), column: fc.nat({ max: 100 }), notes: fc.array(fc.string({ maxLength: 12 }), { maxLength: 3 })
  })
  fc.assert(fc.property(fc.array(diagnostic, { minLength: 1, maxLength: 8 }), fc.integer({ min: 1, max: 127 }), (diagnostics, code) => {
    const baseline = { code, diagnostics }
    const current = diagnostics.map(d => ({ ...d, file: d.file?.replace(/\.ts$/, ".vibe") ?? null, line: d.line + 1 }))
    const files = ["main.vibe"]
    assert.deepEqual(emitErrorsIn(current, files, { code, baseline }), [])
    assert.deepEqual(emitErrorsIn(current.slice(1), files, { code: current.length === 1 ? 0 : code, baseline }), [], "fixing an inherited error is allowed")
    for (const fresh of [
      { ...current[0], file: "main.vibe", message: current[0].message + " new" },
      { ...current[0], file: null, code: "TS5051" },
      { ...current[0], file: "other.vibe", notes: [...current[0].notes, "new reference"] }
    ]) assert.ok(emitErrorsIn([...current, fresh], files, { code, baseline }).length, "new program errors cannot hide behind an inherited exit")
    assert.ok(emitErrorsIn([...current, current[0]], files, { code, baseline }).length, "extra copies are new diagnostics")
    assert.ok(emitErrorsIn([], files, { code, baseline }).length, "a diagnostic-free failing exit is unexplained")
    assert.deepEqual(emitErrorsIn(current, files, { code: code + 1, baseline }), [], "the original diagnostic set, rather than a numeric failure status, decides inheritance")
  }), { seed: 12752986, numRuns: 600 })
})

test("emit comparison does not forgive severity, referenced types or unrecorded failure", () => {
  const diagnostic = corpus.baseline.diagnostics[0]
  const baseline = { code: 1, diagnostics: [{ ...diagnostic, category: "warning" }] }
  assert.ok(emitErrorsIn([diagnostic], [], { code: 1, baseline }).length)
  assert.ok(emitErrorsIn([{ ...diagnostic, message: diagnostic.message.replace("AnimatedNode", "NewType") }], [], { code: 1, baseline: corpus.baseline }).length)
  assert.ok(emitErrorsIn([diagnostic], [], { code: 1, baseline: { code: 0, diagnostics: [] } }).length)
})
