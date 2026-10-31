import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { analyze, cause, collect, failedTests, flakes, parseRun, report, slow, start, targetLines } from "../lib/steps.mjs"

const t = (label, status, key, ms = 1000) => ({ label, status, key, ms })

test("flakes keeps a key that passed and failed, not a key that only failed", () => {
  const runs = [
    { id: "a", at: "t1", targets: [t("//x", "failed", "k1"), t("//real", "failed", "k2")] },
    { id: "b", at: "t2", targets: [t("//x", "ran", "k1"), t("//real", "failed", "k2")] },
    { id: "c", at: "t3", targets: [t("//real", "ran", "k3")] }
  ]
  assert.deepEqual(flakes(runs), [{ label: "//x", key: "k1", passed: 1, failed: ["a"], last: "t1" }])
})

test("a replay proves its key passed, but its time is not a run", () => {
  const runs = [{ id: "a", targets: [t("//x", "failed", "k")] }, { id: "b", targets: [t("//x", "hit", "k", 1)] }]
  assert.equal(flakes(runs).length, 1)
  assert.deepEqual(slow(runs), [{ label: "//x", runs: 1, medianS: 1, p90S: 1, totalS: 1 }])
})

test("failedTests names failures from bun, node --test and go test", () => {
  assert.deepEqual(failedTests([
    "(pass) fine [1.00ms]",
    "(fail) package: static imports [5106.40ms]",
    "✖ a node test (20.5ms)",
    "✖ failing tests:",
    "    --- FAIL: TestVIPConstructs/vip18 (0.01s)"
  ]), ["package: static imports", "a node test", "TestVIPConstructs/vip18"])
})

test("cause prefers what a code change cannot explain", () => {
  assert.equal(cause(["AssertionError", "write /tmp/x: no space left on device"]), "disk full")
  assert.equal(cause(["this test timed out after 5000ms", "AssertionError"]), "timeout")
  assert.equal(cause(["AssertionError: rollup --watch: no build success within 60s"]), "timeout")
  assert.equal(cause(["AssertionError [ERR_ASSERTION]"]), "assertion")
  assert.equal(cause(["Error: property paths-imports failed; saved /r/failure.json", "this test timed out"]), "property counterexample")
  assert.equal(cause(["ok"]), "unknown")
})

test("targetLines keeps one target's lines", () => {
  assert.deepEqual(targetLines("//a: one\n//b: two\n//a: three\n", "//a"), ["one", "three"])
  // Past the live output limit, a failed target's captured output has no prefix.
  const log = "//a: … live output limit reached\n//a  failed  5.1s  command failed\n(fail) late [5106.40ms]\n//b  ran  1s\nnot a\n"
  assert.deepEqual(failedTests(targetLines(log, "//a")), ["late"])
})

test("parseRun refuses a file cut off mid-write and keeps real targets", () => {
  assert.equal(parseRun("x", "{\"results\":[", "t"), null)
  assert.deepEqual(parseRun("x", JSON.stringify({ results: [{ label: "//a", status: "ran", key: "k", durationMs: 2 }, { label: "//b", status: "skipped" }] }), "t").targets, [t("//a", "ran", "k", 2)])
})

test("a run reports the fixture's flakes, tests and causes, and resumes", (c) => {
  const run = mkdtempSync(join(tmpdir(), "ci-health-"))
  c.after(() => rmSync(run, { recursive: true, force: true }))
  start(run, { results: new URL("../fixture", import.meta.url).pathname, since: "" })
  assert.equal(collect(run).unreadable, 1)
  analyze(run)
  const first = report(run)
  assert.ok(first.flaky.includes("//:docs-tools"))
  assert.ok(!first.flaky.includes("//:spec-tests"), "a key that never passed is a real break")
  assert.deepEqual(report(run), first)
})
