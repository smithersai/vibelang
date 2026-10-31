import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { compareTests, stableName } from "../lib/tests.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")

// Smithers run 2, capability batch 01: test/Permission.test.ts:426 names a
// case with it.each([[new Date()]])("... %s"), so its name differs on every
// run, and verify listed the baseline's as missing.
test("smithers run 2: a test whose name prints the run's date is the same test", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-test-name-date.json", import.meta.url), "utf8"))
  const comparison = compareTests({ code: 0, tests: corpus.baseline }, { code: 0, tests: corpus.current })
  assert.deepEqual(comparison, { ok: true, newFailures: [], missing: [], fixed: [] })
})

// For any date and any spelling of it a run prints, two runs that differ only
// in that date compare ok; a test that is gone, or fails now, is still found.
test("compareTests matches tests whose names differ only in a printed date", () => {
  const date = fc.date({ min: new Date("1970-01-02T00:00:00Z"), max: new Date("2200-01-01T00:00:00Z"), noInvalidDate: true })
  const spell = fc.constantFrom((d) => String(d), (d) => d.toString(), (d) => d.toUTCString(), (d) => d.toISOString())
  const word = fc.stringMatching(/^[a-z][a-z ]{0,12}$/)
  fc.assert(fc.property(date, date, spell, word, word, fc.constantFrom("passed", "failed"), (first, second, show, before, after, status) => {
    const name = (d) => `test/Permission.test > rejects ${before}: ${show(d)} ${after}`
    assert.equal(stableName(name(first)), stableName(name(second)))
    const other = "test/Permission.test > accepts a record"
    const baseline = { code: 0, tests: { [name(first)]: status, [other]: "passed" } }
    assert.deepEqual(compareTests(baseline, { code: 0, tests: { [name(second)]: status, [other]: "passed" } }), { ok: true, newFailures: [], missing: [], fixed: [] })
    const gone = compareTests(baseline, { code: 0, tests: { [name(second)]: status } })
    assert.deepEqual(gone.missing, [other])
    if (status === "passed") assert.deepEqual(compareTests(baseline, { code: 0, tests: { [name(second)]: "failed", [other]: "passed" } }).newFailures, [stableName(name(first))])
  }), { seed: 31105, numRuns: 400 })
})

// Names with no date stay as they are; two dated names of one test file that
// become one name are told apart by order, as repeated names are.
test("stableName leaves other names and keeps two dated tests apart", () => {
  for (const name of ["a > 2026 plan", "b > 12:00:00 noon", "c > v2026-10-31", "d > Sat Oct 31"]) assert.equal(stableName(name), name)
  const tests = { "f > at 2026-10-31T16:29:01.000Z": "passed", "f > at 2026-10-31T16:29:02.000Z": "failed" }
  const next = { "f > at 2027-01-01T00:00:00.000Z": "passed", "f > at 2027-01-01T00:00:01.000Z": "failed" }
  assert.deepEqual(compareTests({ code: 0, tests }, { code: 0, tests: next }), { ok: true, newFailures: [], missing: [], fixed: [] })
})
