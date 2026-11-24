// Issue #511: the eval counted a check that never ran as passed, and its
// baseline held declarations and recorded at 0, where no drop can show.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { checksScore, unmetPromises, verifyChecks } from "../eval-scores.mjs"

// The shape verify writes for a one-pass run (lib/steps.mjs): distList's
// receipt is not-run with ok: true, so checks.distList is true.
const onePass = {
  checks: { tests: true, declarations: false, distList: true, packLoad: true, style: true },
  distList: { state: "not-run", ok: true, reason: "a one-pass run builds in its measurement workspaces, not the target" },
  packLoad: { state: "not-run", ok: true, reason: "no published package" },
  tests: { status: "passed" }
}

test("a not-run check is outside the checks denominator", () => {
  const split = verifyChecks(onePass)
  assert.deepEqual(split, { passed: ["tests", "style"], failed: ["declarations"], notRun: ["distList", "packLoad"] })
  assert.equal(checksScore(split), 2 / 3)
})

test("a not-run check that verify fails on stays failed", () => {
  const split = verifyChecks({ checks: { packLoad: false }, packLoad: { state: "not-run", ok: false, reason: "the candidate was not packed" } })
  assert.deepEqual(split, { passed: [], failed: ["packLoad"], notRun: [] })
})

test("no verify scores 0 checks", () => {
  assert.deepEqual(verifyChecks(undefined), { passed: [], failed: [], notRun: [] })
  assert.equal(checksScore(verifyChecks(undefined)), 0)
})

test("a 0 for declarations or recorded is an unmet promise; other scores and nonzero ones are not", () => {
  const at = { case: "smthrs-canonical", scorer: "x", stepKey: "k", at: "t", kind: "score" }
  assert.deepEqual(unmetPromises([
    { ...at, scorerName: "declarations", score: 0 },
    { ...at, scorerName: "recorded", score: 1 },
    { ...at, scorerName: "migrated", score: 0 },
    { ...at, scorerName: "recorded", kind: "inconclusive", reason: "r" }
  ]), ["smthrs-canonical: declarations"])
})

test("the recorded baseline still scores the promised scores 0, so the eval fails until the fixture reaches them", () => {
  const { records } = JSON.parse(readFileSync(new URL("../baseline.json", import.meta.url), "utf8"))
  assert.deepEqual(unmetPromises(records.map((r) => ({ ...r, kind: "score" }))).sort(),
    ["smthrs-canonical: declarations", "smthrs-canonical: recorded"])
})
