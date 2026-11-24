import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { analyze, cause, collect, failedTests, flakes, intermittent, parseRun, regressions, report, slow, start, targetLines } from "../lib/steps.mjs"

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

test("intermittent names a test that failed again after its target passed, under any keys", () => {
  const runs = [
    { id: "a", at: "t1", targets: [t("//x", "failed", "k1"), t("//fixed", "failed", "k1"), t("//broken", "failed", "k1")] },
    { id: "b", at: "t2", targets: [t("//x", "ran", "k2"), t("//fixed", "ran", "k2"), t("//broken", "failed", "k2")] },
    { id: "c", at: "t3", targets: [t("//x", "failed", "k3"), t("//fixed", "hit", "k2"), t("//broken", "ran", "k3")] },
    { id: "d", at: "t4", targets: [t("//x", "failed", "k4")] }
  ]
  // //x's other test failed in b's place only once; //broken's test failed twice in a row, then was fixed.
  const failed = { "a //x": ["deadline"], "c //x": ["deadline", "other"], "d //x": ["deadline"], "a //fixed": ["once"], "a //broken": ["until b"], "b //broken": ["until b"] }
  assert.deepEqual(intermittent(runs, (id, label) => failed[`${id} ${label}`] ?? []),
    [{ label: "//x", name: "deadline", failures: 3, returns: 1, last: "t4" }])
})

test("failedTests names failures from bun, node --test, go test and the compiler case harness", () => {
  assert.deepEqual(failedTests([
    "(pass) fine [1.00ms]",
    "(fail) package: static imports [5106.40ms]",
    "✖ a node test (20.5ms)",
    "✖ failing tests:",
    "    --- FAIL: TestVIPConstructs/vip18 (0.01s)",
    "FAIL    decl-error-family: out/run.mjs printed {\"tags\":[\"Timeout\"]} (1.3 s)"
  ]), ["package: static imports", "a node test", "TestVIPConstructs/vip18", "decl-error-family"])
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

test("regressions reports a target whose median grew 1.5 times and 30 s, with the first slow run", () => {
  const runs = []
  for (let i = 0; i < 12; i++) {
    const after = i >= 6
    runs.push({ id: `r${i}`, at: `t${String(i).padStart(2, "0")}`, targets: [
      t("//slower", "ran", `k${i}`, (after && i !== 6 ? 300 : 100) * 1000),
      t("//load", "ran", `k${i}`, (after ? 130 : 100) * 1000),
      t("//tiny", "ran", `k${i}`, (after ? 20 : 5) * 1000),
      ...(i < 3 ? [t("//rare", "ran", `k${i}`, 1000)] : [t("//rare", "ran", `k${i}`, 900000)])
    ] })
  }
  const found = regressions(runs, { split: "t06" })
  assert.deepEqual(found.map((r) => r.label), ["//slower"])
  assert.deepEqual(found[0], { label: "//slower", beforeRuns: 6, afterRuns: 6, beforeMedianS: 100, afterMedianS: 300, ratio: 3, timeouts: 0, firstSlow: { run: "r7", at: "t07" } })
  assert.deepEqual(regressions(runs).map((r) => r.label), ["//slower"], "the split defaults to the middle run")
})

test("regressions reports timeouts after the split even when the median held", () => {
  const runs = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, at: `t${i}`, targets: [t("//x", i === 8 ? "failed" : "ran", `k${i}`, 100000)] }))
  const found = regressions(runs, { split: "t5", timedOut: (id, label) => id === "r8" && label === "//x" })
  assert.deepEqual(found.map((r) => [r.label, r.timeouts, r.ratio]), [["//x", 1, 1]])
  assert.deepEqual(regressions(runs, { split: "t5" }), [], "a failure that is not a timeout is not a slowdown")
})

test("plain reporter test names do not supply infrastructure evidence", () => {
  for (const header of [
    "(fail) retries after ENOSPC is reported [1.00ms]",
    "--- FAIL: TestTimeoutIsPropagated (0.01s)",
    "✖ kills the child with SIGKILL after the grace period (2ms)",
    "FAIL    timed-out-case: test command failed",
  ]) assert.equal(cause([header, "AssertionError: 1 !== 2"]), "assertion")
  assert.equal(cause(["FAIL    case: process timed out after 50ms"]), "timeout")
})

test("captured output retains source comments and the tests after them", () => {
  const log = [
    "//:t  failed  5.1s  command failed (exit 1): bun test",
    "// a source comment the assertion diff printed",
    "//source: another comment with a colon",
    "(fail) the real failing test [1.00ms]",
    "//:u  ran  1s",
    "(fail) another target's failure [1.00ms]",
  ].join("\n")
  assert.deepEqual(failedTests(targetLines(log, "//:t")), ["the real failing test"])
})

test("empty results cannot produce a successful health report", t => {
  const run = mkdtempSync(join(tmpdir(), "ci-health-empty-"))
  t.after(() => rmSync(run, { recursive: true, force: true }))
  start(run, { results: run })
  assert.equal(collect(run).ok, false)
  assert.equal(analyze(run).ok, false)
  assert.equal(report(run).ok, false)
})

test("collect uses run timestamps across reordered copies and normalizes offset filters", t => {
  const run = mkdtempSync(join(tmpdir(), "ci-health-timestamps-"))
  t.after(() => rmSync(run, { recursive: true, force: true }))
  const results = join(run, "results")
  mkdirSync(results)
  const older = join(results, "older-graph.json")
  const newer = join(results, "newer-graph.json")
  writeFileSync(older, JSON.stringify({ startedAt: "2026-11-01T00:00:00Z", results: [] }))
  writeFileSync(newer, JSON.stringify({ results: [] }))
  writeFileSync(join(results, "times.json"), JSON.stringify({ newer: "2026-11-02T00:00:00Z" }))
  writeFileSync(join(results, "partial-graph.json"), '{"results":')
  utimesSync(older, new Date("2026-11-10"), new Date("2026-11-10"))
  utimesSync(newer, new Date("2026-10-20"), new Date("2026-10-20"))
  start(run, { results, since: "2026-10-31T18:00:00-07:00", split: "2026-11-01T12:00:00-07:00" })
  const collected = collect(run)
  assert.deepEqual(collected.runs.map(row => row.id), ["newer"])
  assert.equal(collected.split, "2026-11-01T19:00:00.000Z")
  assert.deepEqual(collected.unreadableFiles, ["partial-graph.json"])
  analyze(run)
  report(run)
  assert.match(readFileSync(join(run, "report.md"), "utf8"), /Unreadable results: 1/)
})
