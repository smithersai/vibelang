// The target's tests, run with its own command. A Vitest command also writes
// Vitest's JSON report, so each test is compared by name with the baseline;
// so is a command whose printed lines the run's --test-report pattern reads;
// any other command is compared by its exit status alone.
import { existsSync } from "node:fs"
import { posix } from "node:path"
import { quote, readJson, run } from "./util.mjs"

export const isVitest = (command) => /\bvitest\b/.test(command)

/**
 * The command with Vitest's JSON reporter added beside its default one. With
 * coverage on, the coverage report is written even when a test fails, as it
 * does in a baseline with failures the target already had.
 */
export function withJsonReporter(command, outFile) {
  if (!isVitest(command)) return command
  const coverage = /(?:^|\s)--coverage(?:\s|$)/.test(command) ? " --coverage.reportOnFailure" : ""
  return `${command}${coverage} --reporter=default --reporter=json --outputFile.json=${quote(outFile)}`
}

// A test keeps its identity when its file moves from .ts to .vibe.
const fileKey = (root, file) => posix.relative(root, file).replace(/\.(?:ts|tsx|vibe)$/, "")

/** Reads Vitest's JSON report into one status per test: "file > full name". */
export function parseVitestJson(report, root) {
  const tests = {}
  for (const file of report.testResults ?? []) {
    const key = fileKey(root, file.name)
    if (!file.assertionResults?.length) {
      tests[`${key} > (file)`] = file.status === "passed" ? "passed" : "failed"
      continue
    }
    const seen = new Map()
    for (const a of file.assertionResults) {
      // Two tests of one file may share a name; number the repeats in file order.
      const name = `${key} > ${a.fullName ?? a.title}`
      const n = (seen.get(name) ?? 0) + 1
      seen.set(name, n)
      tests[n === 1 ? name : `${name} [${n}]`] = a.status
    }
  }
  return tests
}

/**
 * Reads the per-test lines a runner prints into one status per test name:
 * pattern, a regular expression, matches one test's line (color codes
 * removed) with the named groups name and status. A status ✓, ✔, pass,
 * passed or ok is passed; ✗, ✘, ×, fail, failed or not ok is failed; any
 * other is skipped. alchemy's runner prints
 * `[ 3/9 ✓ 2 ✗ 1] ✓ Domain > commits (12ms)`, which
 * `^\[[^\]]*\] (?<status>[✓✗↓]) (?<name>.+?)(?: \(\d[\d.]*m?s\))?$` reads.
 */
export function parseReport(output, pattern) {
  const line = new RegExp(pattern)
  const tests = {}
  for (const raw of output.split("\n")) {
    const m = line.exec(raw.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r$/, ""))
    const name = m?.groups?.name?.trim()
    if (!name) continue
    const status = (m.groups.status ?? "").trim()
    tests[name] = /^(?:✓|✔|pass|passed|ok)$/i.test(status) ? "passed" : /^(?:✗|✘|×|fail|failed|not ok)$/i.test(status) ? "failed" : "skipped"
  }
  return tests
}

/** Counts of a test map, and the failing tests' names. */
export function tally(tests) {
  const names = Object.keys(tests)
  const failed = names.filter((n) => tests[n] === "failed").sort()
  return {
    total: names.length,
    passed: names.filter((n) => tests[n] === "passed").length,
    failed,
    skipped: names.filter((n) => !["passed", "failed"].includes(tests[n])).length
  }
}

/**
 * Runs the tests and reads what they report: Vitest's JSON, or the lines the
 * report pattern reads (parseReport). A run with no per-test report is
 * judged by its exit status alone, which cannot tell a flaky test from a
 * failing one, so a nonzero exit runs the tests once more and the second
 * run's status counts; rerun holds the first exit status.
 */
export async function runTests({ command, report, cwd, root, jsonFile, log, env }) {
  const once = async (log) => {
    const result = await run(withJsonReporter(command, jsonFile), { cwd, log, env })
    if (isVitest(command) && existsSync(jsonFile)) return { result, tests: parseVitestJson(readJson(jsonFile), root) }
    const printed = report ? parseReport(result.stdout + result.stderr, report) : {}
    return { result, tests: Object.keys(printed).length ? printed : null }
  }
  let { result, tests } = await once(log)
  let rerun
  if (!tests && result.code !== 0) {
    rerun = { code: result.code }
    ;({ result, tests } = await once(log && log.replace(/(?:\.log)?$/, ".rerun.log")))
  }
  return { code: result.code, ms: result.ms, tests, ...(rerun ? { rerun } : {}), ...(tests ? tally(tests) : { total: null, passed: null, failed: [], skipped: null }) }
}

/**
 * What changed against the baseline: tests that now fail and did not, tests
 * that passed and are gone, and an exit status that turned nonzero when no
 * per-test report says why.
 */
export function compareTests(baseline, current) {
  if (!baseline.tests || !current.tests) {
    const regressed = baseline.code === 0 && current.code !== 0
    return { ok: !regressed, newFailures: regressed ? ["(exit status)"] : [], missing: [], fixed: [] }
  }
  const newFailures = Object.keys(current.tests).filter((n) => current.tests[n] === "failed" && baseline.tests[n] !== "failed").sort()
  const missing = Object.keys(baseline.tests).filter((n) => baseline.tests[n] === "passed" && !(n in current.tests)).sort()
  const fixed = Object.keys(baseline.tests).filter((n) => baseline.tests[n] === "failed" && current.tests[n] === "passed").sort()
  return { ok: !newFailures.length && !missing.length, newFailures, missing, fixed }
}

/**
 * The setup issue for a change that broke the target's tests before any file
 * moved, or null when nothing regressed. A runner without per-test results,
 * such as Bun's, is judged by its exit status, and the issue names both logs,
 * which say which tests fail.
 */
export function regressionIssue({ change, command, cwd, changed, before, after, comparison, logs }) {
  if (comparison.ok) return null
  const perTest = Boolean(before.tests && after.tests)
  const count = comparison.newFailures.length + comparison.missing.length
  return {
    kind: "issue",
    batch: "setup",
    title: perTest ? `${change} fails ${count} of the target's tests` : `${change} makes the target's tests exit ${after.code}`,
    repro: `${command} (in ${cwd}), before and after ${changed.length ? changed.join(", ") : "the change"}; logs ${logs.before} and ${logs.after}`,
    expected: "the target's tests pass as they did before the change",
    actual: perTest
      ? [...comparison.newFailures.map((n) => `fails: ${n}`), ...comparison.missing.map((n) => `missing: ${n}`)].join("; ")
      : `exit ${before.code} before, exit ${after.code} after; the runner reports no per-test results`
  }
}
