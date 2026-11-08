import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"
import { newErrors, parseDiagnostics, styleProblems, warningExceptions } from "../lib/diagnostics.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")

const diagnostic = fc.record({
  file: fc.constantFrom("src/a.vibe", "src/b.vibe", "src/outside.ts"),
  line: fc.integer({ min: 1, max: 300 }),
  column: fc.integer({ min: 1, max: 100 }),
  category: fc.constantFrom("warning", "error", "message", "suggestion"),
  code: fc.oneof(fc.constantFrom("EK4833", "EK4839", "EK4802", "EK4402", "EK9204", "EK4832", "EK3822", "TS6133"),
    fc.integer({ min: 1, max: 999999 }).map(n => "FUTURE" + n),
    fc.integer({ min: 1, max: 999999 }).map(n => "EK" + n)),
  refusal: fc.constantFrom("note", "none")
})

test("property: generated diagnostic mixes never promote a warning to a style failure", () => {
  fc.assert(fc.property(fc.array(diagnostic, { maxLength: 40 }), fc.subarray(["src/a.vibe", "src/b.vibe"]), (entries, files) => {
    const output = entries.map(d => d.file + "(" + d.line + "," + d.column + "): " + d.category + " " + d.code + ": finding\n" +
      (d.refusal === "note" ? "  No quick fix: preserve the public signature.\n" : "")).join("")
    const ds = parseDiagnostics(output)
    const problems = styleProblems(ds, files)
    const scopedErrors = ds.filter(d => files.includes(d.file) && d.category === "error")
    assert.ok(problems.every(d => d.category === "error"))
    assert.deepEqual(problems, scopedErrors.filter(d => /^EK48\d\d$/.test(d.code) || ["EK4402", "EK9204"].includes(d.code)))
    // This is the complete rejection criterion for modules' own diagnostics.
    // Include the same errors in baseline: an own .vibe error must still return.
    const rejected = [...newErrors(ds, ds), ...scopedErrors, ...problems]
    assert.deepEqual(new Set(rejected.map(d => d.file)), new Set(scopedErrors.map(d => d.file)))
    const exceptions = warningExceptions(ds, files)
    const expected = ds.filter(d => files.includes(d.file) && d.category === "warning")
    assert.deepEqual(new Set(exceptions.map(e => [e.file, e.line, e.column, e.code].join(":"))),
      new Set(expected.map(d => [d.file, d.line, d.column, d.code].join(":"))))
    assert.ok(exceptions.every(e => e.category === "warning" && e.reason && e.message))
    assert.deepEqual(warningExceptions([...ds, ...ds].reverse(), files), exceptions)
    for (const d of expected) {
      const e = exceptions.find(e => e.file === d.file && e.line === d.line && e.column === d.column && e.code === d.code)
      const refused = d.notes.length > 0
      assert.equal(e.name, refused ? "warning-fix-refused" : "warning-retained")
    }
  }), { numRuns: 500, seed: 48394802 })
})

test("imported diagnostic warnings never exempt an error", () => {
  const ds = parseDiagnostics("src/a.vibe(9,4): warning FUTURE12345: advisory\nsrc/b.vibe(9,4): warning FUTURE12345: same code elsewhere\nsrc/a.vibe(10,4): error EK4833: error\n  No quick fix: keep this.\n")
  assert.deepEqual(styleProblems(ds, ["src/a.vibe"]), [ds[2]])
  assert.deepEqual(warningExceptions(ds, ["src/b.vibe"]).map(e => e.name), ["warning-retained"])
})
