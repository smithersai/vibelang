import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { exactly } from "../scoring.mjs"
import { analyze, collect, report, start } from "../lib/steps.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")

test("repeated expected or observed labels count once in set scores", () => {
  assert.equal(exactly(["same", "same"], ["same"]), 1)
  assert.equal(exactly(["same"], ["same", "same"]), 1)
  assert.equal(exactly(["a", "a", "b"], ["b", "c", "c"]), 0.25)
  assert.equal(exactly([], ["unexpected", "unexpected"]), 0)
})

test("matching names across both actual reporter targets receive a perfect set score", () => {
  const run = mkdtempSync(join(tmpdir(), "ci-health-joint-scores-"))
  try {
    start(run, { results: new URL("../fixture-combined-reporters/", import.meta.url).pathname, since: "" })
    collect(run)
    const analysis = analyze(run)
    const result = report(run)
    assert.deepEqual(result.flaky, ["//packages:compiler-test-2", "//packages:migrate-test"])
    for (const names of [result.tests, result.intermittent]) {
      const distinct = [...new Set(names)]
      assert.ok(names.length > distinct.length, "real targets must report overlapping failure names")
      assert.ok(distinct.includes("__proto__") && distinct.includes("constructor"))
      assert.equal(exactly(distinct, names), 1)
      assert.equal(exactly([...distinct, ...distinct], names), 1)
    }
    assert.ok(analysis.flaky.every(target => target.tests.every(item => item.failures === 2)),
      "scoring must preserve each target and failure counter")
    assert.deepEqual(report(run), result, "the report retains its original per-target observations")
  } finally {
    rmSync(run, { recursive: true, force: true })
  }
})

test("generated repeated labels and permutations keep set scores finite and unchanged", () => {
  const name = fc.oneof(fc.constantFrom("__proto__", "constructor", "toString"),
    fc.array(fc.constantFrom(..."abcXYZ_:/012"), { minLength: 1, maxLength: 8 }).map(chars => chars.join("")))
  const labels = fc.array(name, { maxLength: 20 })
  fc.assert(fc.property(labels, labels, (want, got) => {
    const value = exactly(want, got)
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 1)
    assert.equal(exactly(want, want), 1)
    assert.equal(exactly([...want].reverse(), [...got].reverse()), value)
    assert.equal(exactly(want.flatMap(name => [name, name]), got), value)
    assert.equal(exactly(want, got.flatMap(name => [name, name, name])), value)
    assert.equal(exactly([...new Set(want)], [...new Set(got)]), value)
  }), { seed: 332, numRuns: 500 })
})

