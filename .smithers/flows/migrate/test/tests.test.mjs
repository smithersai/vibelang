import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { validateIssue } from "../lib/issues.mjs"
import { compareTests, parseVitestJson, regressionIssue, runTests, tally, withJsonReporter } from "../lib/tests.mjs"

test("withJsonReporter adds Vitest's JSON reporter only to a Vitest command", () => {
  assert.equal(withJsonReporter("pnpm exec vitest run", "/run/v.json"), "pnpm exec vitest run --reporter=default --reporter=json --outputFile.json='/run/v.json'")
  assert.equal(withJsonReporter("bun test", "/run/v.json"), "bun test")
  assert.equal(withJsonReporter("vitest run --coverage", "/v.json"), "vitest run --coverage --coverage.reportOnFailure --reporter=default --reporter=json --outputFile.json='/v.json'")
})

const report = (ext, statusOf) => ({
  testResults: [
    { name: `/repo/src/a.test.${ext}`, status: "passed", assertionResults: [{ fullName: "a works", status: statusOf("a works") }, { fullName: "a skips", status: "skipped" }] },
    { name: "/repo/src/b.test.ts", status: "failed", assertionResults: [] }
  ]
})

test("parseVitestJson keys tests by file without extension and full name", () => {
  const tests = parseVitestJson(report("ts", () => "passed"), "/repo")
  assert.deepEqual(tests, { "src/a.test > a works": "passed", "src/a.test > a skips": "skipped", "src/b.test > (file)": "failed" })
  assert.deepEqual(tally(tests), { total: 3, passed: 1, failed: ["src/b.test > (file)"], skipped: 1 })
  assert.deepEqual(parseVitestJson(report("vibe", () => "passed"), "/repo"), tests)
})

test("tests that share a name in one file keep one entry each", () => {
  const tests = parseVitestJson({ testResults: [{ name: "/repo/a.test.ts", assertionResults: [{ fullName: "same", status: "passed" }, { fullName: "same", status: "failed" }] }] }, "/repo")
  assert.deepEqual(tests, { "a.test > same": "passed", "a.test > same [2]": "failed" })
})

test("compareTests finds new failures and missing tests, and ignores failures the baseline had", () => {
  const baseline = { code: 1, tests: { "a > x": "passed", "a > y": "failed", "a > z": "passed" } }
  assert.deepEqual(compareTests(baseline, { code: 1, tests: { "a > x": "passed", "a > y": "failed", "a > z": "passed" } }), { ok: true, newFailures: [], missing: [], fixed: [] })
  assert.deepEqual(compareTests(baseline, { code: 1, tests: { "a > x": "failed", "a > y": "passed" } }), { ok: false, newFailures: ["a > x"], missing: ["a > z"], fixed: ["a > y"] })
})

test("without per-test results, only the exit status can regress", () => {
  assert.equal(compareTests({ code: 0, tests: null }, { code: 1, tests: null }).ok, false)
  assert.equal(compareTests({ code: 1, tests: null }, { code: 1, tests: null }).ok, true)
})

// A real Bun suite, which reports no per-test results: setup used to throw
// before comparing it, so a regression the setup caused went unrecorded.
test("a Bun suite that a change breaks is a setup issue with both exits and logs", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-bun-"))
  try {
    writeFileSync(join(root, "package.json"), '{ "name": "fixture", "type": "module" }\n')
    writeFileSync(join(root, "value.ts"), "export const value = 1\n")
    writeFileSync(join(root, "value.test.ts"), 'import { expect, test } from "bun:test"\nimport { value } from "./value.ts"\ntest("value", () => expect(value).toBe(1))\n')
    const logs = { before: join(root, "logs/before.log"), after: join(root, "logs/after.log") }
    const run = (name) => runTests({ command: "bun test", cwd: root, root, jsonFile: join(root, `${name}.json`), log: logs[name] })
    const before = await run("before")
    assert.deepEqual([before.code, before.tests], [0, null])
    const unchanged = { change: "Setting up VibeLang", command: "bun test", cwd: ".", changed: ["value.ts"], before, after: before, comparison: compareTests(before, before), logs }
    assert.equal(regressionIssue(unchanged), null)

    writeFileSync(join(root, "value.ts"), "export const value = 2\n")
    const after = await run("after")
    assert.equal(after.code, 1)
    const issue = regressionIssue({ ...unchanged, after, comparison: compareTests(before, after) })
    assert.deepEqual(validateIssue(issue), [])
    assert.deepEqual([issue.batch, issue.title], ["setup", "Setting up VibeLang makes the target's tests exit 1"])
    assert.equal(issue.actual, "exit 0 before, exit 1 after; the runner reports no per-test results")
    assert.equal(issue.repro, `bun test (in .), before and after value.ts; logs ${logs.before} and ${logs.after}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("with per-test results, the issue names each new failure and missing test", () => {
  const before = { code: 0, tests: { "a > x": "passed", "a > y": "passed" } }
  const after = { code: 1, tests: { "a > x": "failed" } }
  const issue = regressionIssue({ change: "Upgrading Effect", command: "vitest run", cwd: "pkg", changed: [], before, after, comparison: compareTests(before, after), logs: { before: "b.log", after: "a.log" } })
  assert.equal(issue.title, "Upgrading Effect fails 2 of the target's tests")
  assert.equal(issue.actual, "fails: a > x; missing: a > y")
  assert.equal(issue.repro, "vitest run (in pkg), before and after the change; logs b.log and a.log")
})

test("a runner without per-test results runs again after a nonzero exit, and the second run counts", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-rerun-"))
  try {
    // Fails on its first run only, as a timing flake does under load.
    const flaky = `node -e "const fs = require('node:fs'); const n = fs.existsSync('runs') ? 1 : 0; fs.writeFileSync('runs', 'x'); process.exit(n ? 0 : 1)"`
    const result = await runTests({ command: flaky, cwd: root, root, jsonFile: join(root, "report.json"), log: join(root, "tests.log") })
    assert.equal(result.code, 0)
    assert.deepEqual(result.rerun, { code: 1 })
    assert.ok(existsSync(join(root, "tests.rerun.log")))
    const failing = await runTests({ command: "exit 3", cwd: root, root, jsonFile: join(root, "report.json") })
    assert.equal(failing.code, 3)
    const passing = await runTests({ command: "true", cwd: root, root, jsonFile: join(root, "report.json") })
    assert.equal(passing.rerun, undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
