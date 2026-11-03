import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { analyze, cause, collect, failedTests, report, start, targetLines } from "../lib/steps.mjs"

const fixture = new URL("../fixture-startup/", import.meta.url).pathname
const startup = "TimedOut: ChildProcess.spawn (/bin/sh): The machine was too busy to start the process within 5 s"

test("real startup summary retains its cause without inventing a failing test", () => {
  const log = readFileSync(join(fixture, "run-01-graph.log"), "utf8")
  const lines = targetLines(log, "//packages:runtime-dist")
  assert.ok(lines.some(line => line.includes(startup)))
  assert.equal(cause(lines), "process startup")
  assert.deepEqual(failedTests(lines), [])
})

test("wrapped startup failure is distinct from a test deadline", () => {
  const log = "//x  failed  16.4s  command failed (exit -1): /bin/sh -c test\nThe machine was too busy to start the process within 5 s\n//y  ran  1s\n"
  assert.equal(cause(targetLines(log, "//x")), "process startup")
  assert.equal(cause(["AssertionError: no test result within 5 s"]), "timeout")
  assert.equal(cause(["spawnSync bun ETIMEDOUT"]), "timeout")
  assert.equal(cause(["Property failed; expected TimedOut elsewhere"]), "timeout")
})

test("startup cannot hide an explicit property counterexample or resource failure", () => {
  assert.equal(cause([startup, "Error: property paths-imports failed; saved fixture"]), "property counterexample")
  assert.equal(cause([startup, "ENOSPC"]), "disk full")
  assert.equal(cause([startup, "SIGKILL"]), "killed")
})

test("generated labels, timing fields and adjacent targets keep startup attribution", () => {
  for (let i = 0; i < 128; i++) {
    const label = "//pkg" + i + ":target_" + (i % 2 ? "timeout" : "assertion")
    const other = label + "_other"
    const elapsed = (i / 10).toFixed(1) + "s"
    const lines = targetLines(other + ": AssertionError unrelated\n" + label + "  failed  " + elapsed + "  " + startup + "\n" + other + "  failed  1s\nAssertionError not ours\n", label)
    assert.equal(cause(lines), "process startup")
    assert.ok(lines.every(line => !line.includes("unrelated") && !line.includes("not ours")))
  }
})

test("analyze and report replay the real same-key startup fixture", t => {
  const run = mkdtempSync(join(tmpdir(), "ci-health-startup-"))
  t.after(() => rmSync(run, { recursive: true, force: true }))
  start(run, { results: fixture, since: "" })
  assert.equal(collect(run).runs.length, 2)
  const target = analyze(run).flaky.find(target => target.label === "//packages:runtime-dist")
  assert.deepEqual(target.causes, { "process startup": 1 })
  assert.deepEqual(target.tests, [])
  report(run)
  const text = readFileSync(join(run, "report.md"), "utf8")
  assert.match(text, /process startup/)
  assert.match(text, /process-supervisor startup/)
})

test("command arguments are metadata, not failure evidence", () => {
  for (const argument of [
    "property example failed; saved only-as-an-argument",
    "ENOSPC", "SIGKILL", "TimedOut: ChildProcess.spawn (/bin/sh)",
    "test exceeded the time", "ECONNRESET", "AssertionError"
  ]) {
    const log = "//x  failed  2s  command failed (exit -1): node -e " + JSON.stringify(argument) +
      "\nError: Cannot find module actual-missing-package\n//y  ran  1s\n"
    const lines = targetLines(log, "//x")
    assert.equal(cause(lines), "missing file")
    assert.ok(lines[0].includes("command failed (exit -1)"))
    assert.ok(!lines[0].includes(argument), "do not classify command text as output")
  }
})

test("prefix-similar target labels do not capture another target's failure", () => {
  for (const suffix of ["-other", "_other", "/other", ":other"]) {
    const log = "//x" + suffix + "  failed  1s  " + startup + "\n//x  failed  1s  AssertionError: own assertion\n"
    assert.equal(cause(targetLines(log, "//x")), "assertion")
  }
})
