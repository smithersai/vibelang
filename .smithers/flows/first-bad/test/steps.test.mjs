import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { classify, explain, next, parseHistory, parseResults, probe, record, start, verdict } from "../lib/steps.mjs"

const run = (targets) => ({ targets: Object.fromEntries(Object.entries(targets).map(([t, v]) => [t, { verdict: v, tests: [], cause: "", excerpt: "" }])) })

test("a target is broken only when it failed every try; a pass after a failure is a flake", () => {
  const runs = [run({ "//a": "fail", "//b": "fail", "//c": "pass", "//d": "untestable" }), run({ "//a": "fail", "//b": "pass" }), run({ "//a": "fail" })]
  assert.deepEqual(classify(runs, ["//a", "//b", "//c", "//d"]), { "//a": "broken", "//b": "flaky", "//c": "not-reproduced", "//d": "untestable" })
})

test("verdict reads a replay as a pass and a target that never ran as untestable", () => {
  const s = parseResults(JSON.stringify({ results: [{ label: "//a", status: "hit" }, { label: "//b", status: "failed" }, { label: "//c", status: "ran" }] }))
  assert.deepEqual(["//a", "//b", "//c", "//missing"].map((t) => verdict(s, t)), ["pass", "fail", "pass", "untestable"])
  assert.equal(verdict(parseResults("{\"results\": [ cut off"), "//a"), "untestable")
})

// bisectAll drives next and record against a known first bad index per target,
// the way the bisect step drives them against real runs.
function bisectAll(n, firstBad, untestable = new Set()) {
  let ranges = Object.fromEntries(Object.keys(firstBad).map((t) => [t, [-1, n - 1]]))
  const skipped = new Set()
  const probes = []
  for (let i = next(ranges, skipped); i !== null; i = next(ranges, skipped)) {
    assert.ok(!probes.includes(i), `commit ${i} probed twice: the ranges stopped narrowing`)
    probes.push(i)
    const open = Object.keys(ranges).filter((t) => ranges[t][0] < i && i < ranges[t][1])
    ranges = record(ranges, i, Object.fromEntries(open.map((t) => [t, untestable.has(i) ? "untestable" : i >= firstBad[t] ? "fail" : "pass"])), skipped)
  }
  return { ranges, probes }
}

test("bisection finds every first bad commit, at any position, in log2 runs", () => {
  for (let n = 1; n <= 33; n++) {
    for (let bad = 0; bad < n; bad++) {
      const { ranges, probes } = bisectAll(n, { "//t": bad })
      assert.deepEqual(ranges["//t"], [bad - 1, bad], `n=${n} first bad ${bad}`)
      assert.ok(probes.length <= Math.ceil(Math.log2(n + 1)), `n=${n}: ${probes.length} runs`)
      assert.equal(new Set(probes).size, probes.length, "no commit runs twice")
    }
  }
})

test("two targets broken by different commits share the runs both ranges contain", () => {
  const { ranges, probes } = bisectAll(16, { "//a": 3, "//b": 11 })
  assert.deepEqual(ranges, { "//a": [2, 3], "//b": [10, 11] })
  assert.ok(probes.length < 2 * Math.ceil(Math.log2(17)), `${probes.length} runs`)
})

test("an untestable commit is skipped, and the answer widens to include it", () => {
  const { ranges } = bisectAll(8, { "//t": 4 }, new Set([3]))
  assert.deepEqual(ranges["//t"], [2, 4])
  const all = bisectAll(4, { "//t": 3 }, new Set([0, 1, 2]))
  assert.deepEqual(all.ranges["//t"], [-1, 3])
})

test("parseHistory refuses a merge or a gap, and keeps titles with tabs", () => {
  assert.deepEqual(parseHistory("c1\tg\tfix: one\nc2\tc1\tfix:\ttwo\n", "g"), [{ commit: "c1", title: "fix: one" }, { commit: "c2", title: "fix:\ttwo" }])
  assert.throws(() => parseHistory("c1\tg,x\tmerge\n", "g"), /not linear/)
  assert.throws(() => parseHistory("c1\tg\ta\nc3\tc2\tb\n", "g"), /not linear/)
  assert.throws(() => parseHistory("", "g"), /no commits/)
})

test("explain names the first bad commit, the last good one and what failed there", () => {
  const p = { good: "g", commits: [{ commit: "c0", title: "zero" }, { commit: "c1", title: "one" }, { commit: "c2", title: "two" }] }
  const failing = { verdict: "fail", tests: ["TestX"], cause: "assertion", excerpt: "--- FAIL: TestX" }
  const r = { states: { "//a": "broken", "//f": "flaky", "//old": "broken" }, runs: [{ commit: "c2", targets: { "//a": failing, "//f": { ...failing, cause: "timeout" }, "//old": failing } }] }
  const b = { atGood: ["//old"], ranges: { "//a": [0, 1] }, runs: [{ commit: "c1", targets: { "//a": failing } }] }
  assert.deepEqual(explain(p, r, b, ["//a", "//f", "//old"]), {
    "//a": { state: "broken", firstBad: "c1", title: "one", lastGood: "c0", untestable: 0, tests: ["TestX"], excerpt: "--- FAIL: TestX" },
    "//f": { state: "flaky", cause: "timeout", tests: ["TestX"] },
    "//old": { state: "broken-at-good" }
  })
})

test("a run directory answers one question", () => {
  const dir = mkdtempSync(join(tmpdir(), "first-bad-test-"))
  try {
    const o = start(dir, { repo: "/r", good: "g", bad: "b", targets: ["//a"] })
    assert.deepEqual(o, { tries: 3, jobs: 8, repo: "/r", good: "g", bad: "b", targets: ["//a"] })
    assert.deepEqual(start(dir, { repo: "/r", good: "g", bad: "b", targets: ["//a"] }), o)
    assert.throws(() => start(dir, { repo: "/r", good: "g", bad: "b", targets: ["//b"] }), /is a run of g..b/)
    assert.throws(() => start(join(dir, "x"), { repo: "/r", good: "g", bad: "b", targets: [] }), /at least one target/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a target that never ran is run once more at the same commit; a failure is not", () => {
  const calls = []
  const answers = [{ "//a": "untestable", "//b": "fail" }, { "//a": "pass" }]
  const once = (_run, commit, targets, name) => {
    calls.push([commit, targets, name])
    return { code: 1, seconds: 1, ...run(answers[calls.length - 1]) }
  }
  const r = probe("/run", "c1", ["//a", "//b"], 4, once)
  assert.deepEqual(calls, [["c1", ["//a", "//b"], "4"], ["c1", ["//a"], "4b"]])
  assert.deepEqual(Object.fromEntries(Object.entries(r.targets).map(([t, v]) => [t, v.verdict])), { "//a": "pass", "//b": "fail" })
  assert.deepEqual(r.retried, ["//a"])
  calls.length = 0
  answers.splice(0, 2, { "//a": "fail" })
  probe("/run", "c1", ["//a"], 5, once)
  assert.equal(calls.length, 1)
})
