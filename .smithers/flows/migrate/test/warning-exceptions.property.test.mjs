import "./helpers/jj-config.mjs"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"
import { batchRefusals, newErrors, parseDiagnostics, styleProblems, warningExceptions } from "../lib/diagnostics.mjs"

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

// compile's result for one package (lib/steps.mjs compile): errors new
// against the setup baseline, and the style problems of the batch's files.
const compiled = (baseline, diagnostics, files) => ({ diagnostics, newErrors: newErrors(baseline, diagnostics), style: styleProblems(diagnostics, files) })

// The rule, case by case: the style gate holds an error-category EK48xx,
// EK4402 or EK9204 in a batch file, and nothing else.
test("style problems are the batch files' EK48xx, EK4402 and EK9204 errors", () => {
  const line = (file, code, category = "error") => file + "(1,1): " + category + " " + code + ": finding\n"
  const held = ["EK4831", "EK4837", "EK4402", "EK9204"].map(code => line("src/a.vibe", code))
  const passed = [line("src/a.vibe", "EK3822"), line("src/a.vibe", "TS6133"), line("src/outside.vibe", "EK4831"), line("src/a.vibe", "EK4831", "warning")]
  const ds = parseDiagnostics([...held, ...passed].join(""))
  assert.deepEqual(styleProblems(ds, ["src/a.vibe"]).map(d => d.code), ["EK4831", "EK4837", "EK4402", "EK9204"])
})

test("verify refuses a module's own error that the setup baseline already had", () => {
  const ds = parseDiagnostics("src/a.vibe(3,1): error TS2322: Type 'string' is not assignable to type 'number'.\n")
  const refused = batchRefusals(compiled(ds, ds, ["src/a.vibe"]), ["src/a.vibe"])
  assert.deepEqual(refused.newErrors, [])
  assert.deepEqual(refused.batchErrors, ds)
  assert.deepEqual(batchRefusals(compiled(ds, ds, ["src/a.vibe"]), ["src/b.vibe"]).batchErrors, [], "another batch's error is not this batch's")
})

test("property: generated diagnostic mixes never promote a warning to a style failure", () => {
  fc.assert(fc.property(fc.array(diagnostic, { maxLength: 40 }), fc.subarray(["src/a.vibe", "src/b.vibe"]), (entries, files) => {
    const output = entries.map(d => d.file + "(" + d.line + "," + d.column + "): " + d.category + " " + d.code + ": finding\n" +
      (d.refusal === "note" ? "  Preserve the public signature.\n" : "")).join("")
    const ds = parseDiagnostics(output)
    const problems = styleProblems(ds, files)
    const scopedErrors = ds.filter(d => files.includes(d.file) && d.category === "error")
    assert.ok(problems.every(d => scopedErrors.includes(d)))
    // compile's result with a baseline that already holds every error: no
    // error is new, and verify still refuses each of the batch's own errors.
    const refused = batchRefusals(compiled(ds, ds, files), files)
    assert.deepEqual(refused.newErrors, [])
    assert.deepEqual(refused.batchErrors, scopedErrors)
    assert.deepEqual(refused.style, problems)
    const exceptions = warningExceptions(ds, files)
    const expected = ds.filter(d => files.includes(d.file) && d.category === "warning")
    assert.deepEqual(new Set(exceptions.map(e => [e.file, e.line, e.column, e.code].join(":"))),
      new Set(expected.map(d => [d.file, d.line, d.column, d.code].join(":"))))
    assert.ok(exceptions.every(e => e.category === "warning" && e.reason && e.message))
    assert.deepEqual(warningExceptions([...ds, ...ds].reverse(), files), exceptions)
    for (const d of expected) {
      const e = exceptions.find(e => e.file === d.file && e.line === d.line && e.column === d.column && e.code === d.code)
      assert.equal(e.name, "warning-retained")
    }
  }), { numRuns: 500, seed: 48394802 })
})

test("imported diagnostic warnings never exempt an error", () => {
  const ds = parseDiagnostics("src/a.vibe(9,4): warning FUTURE12345: advisory\nsrc/b.vibe(9,4): warning FUTURE12345: same code elsewhere\nsrc/a.vibe(10,4): error EK4833: error\n  Keep this.\n")
  assert.deepEqual(styleProblems(ds, ["src/a.vibe"]), [ds[2]])
  assert.deepEqual(warningExceptions(ds, ["src/b.vibe"]).map(e => e.name), ["warning-retained"])
})
