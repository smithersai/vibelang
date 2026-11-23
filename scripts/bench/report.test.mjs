import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { runSuite } from "./lib/harness.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const reportScript = path.join(root, "scripts/bench/report.mjs")

test("bench harness runs verify before timing and emits schemaVersion 1 JSON", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vibelang-bench-harness-"))
  try {
    const outPath = path.join(dir, "suite.json")
    let verified = false
    const result = await runSuite({
      suite: "unit-harness",
      category: "runtime",
      description: "Harness smoke test",
      argv: ["--out", outPath, "--samples", "3", "--warmup", "1", "--min-ms", "5"],
      cases: [
        {
          name: "sum 100 ints",
          unit: "ns/op",
          fn: () => {
            let s = 0
            for (let i = 0; i < 100; i++) s += i
            return s
          },
          verify: (v) => {
            verified = true
            assert.equal(v, 4950)
          }
        }
      ]
    })
    assert.equal(verified, true)
    assert.equal(result.schemaVersion, 1)
    assert.equal(result.suite, "unit-harness")
    assert.equal(result.benchmarks.length, 1)
    assert.equal(result.benchmarks[0].samples.length, 3)
    assert.ok(result.benchmarks[0].median > 0)
    const saved = JSON.parse(readFileSync(outPath, "utf8"))
    assert.equal(saved.schemaVersion, 1)
    assert.equal(saved.benchmarks[0].name, "sum 100 ints")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("bench harness fails fast if verify throws", async () => {
  await assert.rejects(
    () =>
      runSuite({
        suite: "unit-fail",
        category: "runtime",
        argv: ["--samples", "2", "--warmup", "0", "--min-ms", "2"],
        cases: [
          {
            name: "bad impl",
            fn: () => 41,
            verify: (v) => assert.equal(v, 42)
          }
        ]
      }),
    /41.*42|AssertionError/
  )
})

test("report.mjs aggregates suites, diffs baselines, emits HTML/MD/JSON, and flags regressions", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vibelang-bench-report-"))
  try {
    const baselinePath = path.join(dir, "baseline.json")
    const mdPath = path.join(dir, "report.md")
    const jsonPath = path.join(dir, "report.json")
    const htmlPath = path.join(dir, "report.html")

    writeFileSync(
      baselinePath,
      JSON.stringify({
        schemaVersion: 1,
        suites: [
          {
            suite: "runtime-test",
            category: "runtime",
            benchmarks: [
              { name: "fast", unit: "ns/op", median: 100, nsPerOp: 100 },
              { name: "regressed", unit: "ns/op", median: 100, nsPerOp: 100 }
            ]
          }
        ]
      })
    )
    const suiteFile = path.join(dir, "suite.json")
    writeFileSync(
      suiteFile,
      JSON.stringify({
        schemaVersion: 1,
        suite: "runtime-test",
        category: "runtime",
        description: "Test suite",
        startedAt: "2026-11-22T00:00:00.000Z",
        durationMs: 12.3,
        machine: { cpu: "test", cores: 8, platform: "darwin", arch: "arm64", node: "v26.0.0" },
        benchmarks: [
          { name: "fast", unit: "ns/op", median: 50, nsPerOp: 50, min: 48, mean: 51, p95: 55, max: 56, samples: [48, 50, 55] },
          { name: "regressed", unit: "ns/op", median: 160, nsPerOp: 160, min: 155, mean: 160, p95: 165, max: 166, samples: [155, 160, 165] }
        ]
      })
    )

    const okRun = spawnSync(
      process.execPath,
      [reportScript, "--baseline", baselinePath, "--json", jsonPath, "--md", mdPath, "--html", htmlPath, suiteFile],
      { encoding: "utf8" }
    )
    assert.equal(okRun.status, 0, okRun.stderr)

    const reportJson = JSON.parse(readFileSync(jsonPath, "utf8"))
    assert.equal(reportJson.summary.totalSuites, 1)
    assert.equal(reportJson.summary.totalBenchmarks, 2)
    assert.equal(reportJson.summary.improved, 1)
    assert.equal(reportJson.summary.regressed, 1)

    const md = readFileSync(mdPath, "utf8")
    assert.match(md, /runtime-test/)
    assert.match(md, /-50\.0%/)
    assert.match(md, /\+60\.0%/)

    const html = readFileSync(htmlPath, "utf8")
    assert.match(html, /<!doctype html>/i)
    assert.match(html, /runtime-test/)

    const failRun = spawnSync(
      process.execPath,
      [reportScript, "--baseline", baselinePath, "--fail-on-regression", "25", suiteFile],
      { encoding: "utf8" }
    )
    assert.equal(failRun.status, 1, "expected regression >25% to exit 1")
    assert.match(failRun.stderr, /regressed/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
