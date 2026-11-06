import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { analyze, collect, failedTests, report, start, targetLines } from "../lib/steps.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const inheritedNames = Object.getOwnPropertyNames(Object.prototype)

// A failing regression on the old analyzer must not poison the test runner.
function withCleanPrototypes(work) {
  const objects = [Object.prototype, ...Object.values(Object.getOwnPropertyDescriptors(Object.prototype))
    .flatMap(d => typeof d.value === "function" ? [d.value] : [])]
  const before = objects.map(o => Object.getOwnPropertyDescriptors(o))
  try {
    const result = work()
    assert.deepEqual(objects.map(o => Object.getOwnPropertyDescriptors(o)), before,
      "analysis must not mutate inherited objects or functions")
    return result
  } finally {
    for (const [i, object] of objects.entries()) for (const key of ["failures", "last"]) {
      if (Object.hasOwn(before[i], key)) Object.defineProperty(object, key, before[i][key])
      else delete object[key]
    }
  }
}

for (const [kind, label] of [["node", "//packages:compiler-test-2"], ["migrate", "//packages:migrate-test"]]) {
  test("actual " + kind + " reporter failure names retain independent counters through the saved report", () => {
    const dir = mkdtempSync(join(tmpdir(), "ci-health-names-"))
    try {
      const fixture = new URL("../fixture-" + kind + "-reporter/", import.meta.url)
      const names = failedTests(targetLines(readFileSync(new URL("run-01-graph.log", fixture), "utf8"), label))
      for (const name of ["__proto__", "constructor", "toString"]) assert.ok(names.includes(name))
      withCleanPrototypes(() => {
        start(dir, { results: fixture.pathname, since: "" })
        const runs = collect(dir).runs
        const analysis = analyze(dir)
        const [target] = analysis.flaky
        assert.equal(target.failures, 2)
        assert.equal(target.passes, 2)
        assert.deepEqual(target.tests.map(t => t.name), names)
        for (const item of target.tests) {
          assert.equal(item.failures, 2, item.name)
          assert.equal(item.last, runs[2].at, item.name)
        }
        const saved = JSON.parse(readFileSync(join(dir, "analyze.json"), "utf8"))
        assert.deepEqual(saved, analysis, "counts must survive JSON persistence")
        assert.deepEqual(report(dir).tests, names)
        const text = readFileSync(join(dir, "report.md"), "utf8")
        for (const name of ["__proto__", "constructor", "toString"]) {
          assert.ok(text.includes("| " + name + " | 2 |"), name + " must remain visible with its count")
        }
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

test("generated names keep per-target counts across reporters, keys, duplicates and replayed passes", () => {
  const name = fc.oneof(
    fc.constantFrom(...inheritedNames),
    fc.array(fc.integer({ min: 0, max: 0xffff }), { minLength: 1, maxLength: 20 })
      .map(units => String.fromCharCode(...units)).filter(value => value.trim().length > 0)
  )
  fc.assert(fc.property(
    fc.uniqueArray(name, { minLength: 1, maxLength: 10 }),
    fc.uniqueArray(name, { minLength: 1, maxLength: 10 }),
    (first, second) => withCleanPrototypes(() => {
      const dir = mkdtempSync(join(tmpdir(), "ci-health-generated-names-"))
      try {
        const results = join(dir, "results")
        mkdirSync(results)
        const labels = ["//:first", "//:second"]
        const protocols = [["node-test", "failure"], ["migrate-test", "test-failed"]]
        const sets = [[first, second], [second, first]]
        const runs = []
        for (let i = 0; i < 4; i++) {
          const failing = i % 2 === 0
          const id = "run-" + i
          const at = "2020-01-01T00:00:0" + i + ".000Z"
          runs.push({ id, at, targets: labels.map((label, j) => ({
            label, key: "key-" + Math.floor(i / 2), status: failing ? "failed" : (j ? "hit" : "ran"), ms: 1
          })) })
          const lines = labels.flatMap((label, j) => failing
            ? sets[j][i / 2].flatMap(name => Array(2).fill(label + ": [" + protocols[j][0] + "] " +
                JSON.stringify({ event: protocols[j][1], name })))
            : [])
          writeFileSync(join(results, id + "-graph.log"), lines.join("\n") + "\n")
        }
        start(dir, { results, since: "" })
        writeFileSync(join(dir, "collect.json"), JSON.stringify({ ok: true, runs }))
        const analysis = analyze(dir)
        for (const [j, target] of analysis.flaky.entries()) {
          assert.equal(target.label, labels[j])
          assert.equal(target.keys, 2)
          assert.equal(target.failures, 2)
          assert.equal(target.passes, 2)
          const expected = new Map([...first, ...second].map(name => [name,
            Number(first.includes(name)) + Number(second.includes(name))]))
          assert.deepEqual(new Map(target.tests.map(t => [t.name, t.failures])), expected)
          for (const item of target.tests) {
            assert.equal(item.last, runs[sets[j][1].includes(item.name) ? 2 : 0].at)
          }
        }
        assert.deepEqual(JSON.parse(readFileSync(join(dir, "analyze.json"), "utf8")), analysis)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  ), { seed: 327, numRuns: 100 })
})
