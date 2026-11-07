import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { exactly, regressionScore } from "../scoring.mjs"
import { analyze, collect, report, start } from "../lib/steps.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")

test("an empty expected set gives unexpected labels a finite zero score", () => {
  assert.equal(exactly([], ["unexpected"]), 0)
  assert.equal(exactly(["missing"], []), 0)
  assert.equal(exactly([], []), 1)
  assert.equal(exactly(["a", "b"], ["b", "c"]), 0.25, "nonempty partial scores retain precision times recall")
})

for (const kind of ["node", "migrate"]) {
  test("an empty expectation grades actual " + kind + " report names and targets as zero", () => {
    const run = mkdtempSync(join(tmpdir(), "ci-health-empty-score-"))
    try {
      start(run, { results: new URL("../fixture-" + kind + "-reporter/", import.meta.url).pathname, since: "" })
      collect(run)
      analyze(run)
      const result = report(run)
      for (const names of [result.flaky, result.tests, result.intermittent]) {
        assert.ok(names.length > 0, "the actual report must supply unexpected observations")
        assert.equal(exactly([], names), 0, "a mismatch must have a numeric score")
        assert.equal(exactly(names, []), 0)
        assert.equal(exactly(names, names), 1)
      }
    } finally {
      rmSync(run, { recursive: true, force: true })
    }
  })
}

test("generated label sets always have finite symmetric scores and penalize empty mismatches", () => {
  const name = fc.array(fc.constantFrom(..."abcXYZ_:/-012"), { minLength: 1, maxLength: 15 }).map(chars => chars.join(""))
  const labels = fc.oneof(fc.constant([]), fc.uniqueArray(name, { maxLength: 20 }))
  fc.assert(fc.property(labels, labels, (want, got) => {
    const value = exactly(want, got)
    assert.ok(Number.isFinite(value), "every comparison supplies a usable score")
    assert.ok(value >= 0 && value <= 1)
    assert.equal(value, exactly(got, want), "precision times recall is symmetric")
    assert.equal(exactly(want, [...want].reverse()), 1)
    if (want.length === 0 || got.length === 0) assert.equal(value, Number(want.length === got.length))
    const equal = want.length === got.length && want.every(name => got.includes(name))
    assert.equal(value === 1, equal, "only a matching set gets a perfect score")
    if (want.every(name => !got.includes(name))) assert.equal(value, Number(want.length === 0 && got.length === 0))
    const extra = "unexpected label"
    assert.ok(exactly(want, [...got, extra]) <= value, "an unrelated observation cannot improve a score")
  }), { seed: 330, numRuns: 500 })
})


test("empty duration-regression expectations retain both perfect and mismatching scores", () => {
  assert.equal(regressionScore({}, {}), 1)
  assert.equal(regressionScore({}, { "//:unexpected": 1 }), 0)
  assert.equal(regressionScore({ "//:missing": 1 }, {}), 0)
  assert.equal(regressionScore({ "//:same": 2 }, { "//:same": 2 }), 1)
  assert.equal(regressionScore({ "//:same": 2 }, { "//:same": 1 }), 0)
  assert.equal(regressionScore({ a: 1, b: 2 }, { b: 2, c: 0 }), 0.125)
  assert.equal(regressionScore({ a: 1, b: 2 }, { a: 1, b: 1 }), 0.5)
})

test("generated duration maps keep scores finite and only matching keys and counts get a perfect score", () => {
  const name = fc.array(fc.constantFrom(..."abcXYZ_:/-012"), { minLength: 1, maxLength: 12 }).map(chars => chars.join(""))
  const counts = fc.dictionary(name, fc.integer({ min: 0, max: 20 }), { maxKeys: 12 })
  const maps = fc.oneof(fc.constant({}), counts)
  fc.assert(fc.property(maps, maps, (want, got) => {
    const value = regressionScore(want, got)
    assert.ok(Number.isFinite(value), "an empty duration expectation must still be graded")
    assert.ok(value >= 0 && value <= 1)
    assert.equal(regressionScore(want, { ...want }), 1)
    const equal = Object.keys(want).length === Object.keys(got).length &&
      Object.entries(want).every(([key, count]) => got[key] === count)
    assert.equal(value === 1, equal)
    if (Object.keys(want).length === 0 || Object.keys(got).length === 0) assert.equal(value, Number(equal))
    assert.ok(regressionScore(want, { ...got, "unexpected label": 1 }) <= value)
  }), { seed: 331, numRuns: 500 })
})

