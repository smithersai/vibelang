import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { compareTests, runTests } from "../lib/tests.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const fixture = JSON.parse(readFileSync(new URL("./corpus/t3code-test-report-freshness.json", import.meta.url), "utf8"))
const quote = "Keep every test and fixture unchanged (decided detail 272)."

test("the report freshness oracle retains the migration's test contract", () => {
  assert.ok(readFileSync(new URL("../rules.md", import.meta.url), "utf8").includes(quote))
})

// Exercise the real runner and report reader. The child has no test framework
// dependency: Vitest's documented report envelope and CLI flag are the boundary
// runTests consumes. A missing or late report must not erase a failing process.
async function inspect(input) {
  const root = mkdtempSync(join(tmpdir(), "migrate-report-freshness-"))
  try {
    writeFileSync(join(root, "fake-vitest.mjs"), [
      'import { writeFileSync } from "node:fs"',
      'const [mode, code, count] = process.argv.slice(2)',
      'const out = process.argv.find(arg => arg.startsWith("--outputFile.json=")).slice("--outputFile.json=".length)',
      'if (mode === "write") writeFileSync(out, JSON.stringify({ testResults: [{ name: process.cwd()+"/sample.test.ts", assertionResults: Array.from({length:Number(count)}, (_,i)=>({fullName:"case "+i,status:"passed"})) }] }))',
      'process.exitCode = Number(code)',
      ""
    ].join("\n"))
    const run = (mode, code) => runTests({
      command: "node fake-vitest.mjs " + mode + " " + code + " " + input.count,
      cwd: root, root, jsonFile: join(root, "vitest.json"),
    })
    const baseline = await run("write", input.baselineCode)
    assert.equal(baseline.code, input.baselineCode)
    assert.equal(baseline.total, input.count)
    const current = await run(input.mode, input.code)
    assert.equal(current.code, input.code)
    if (input.mode === "missing") assert.equal(current.tests, null, "a report from the baseline is not this invocation's report")
    else assert.deepEqual(current.tests, baseline.tests)
    const expectedOk = input.mode !== "missing" && !(input.baselineCode === 0 && input.code !== 0)
    assert.equal(compareTests(baseline, current).ok, expectedOk,
      "a missing report or a nonzero command against a passing baseline must fail comparison")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

for (const example of fixture.examples) {
  test(example.key, () => inspect(example.input))
}

test("report freshness covers reused paths, report omissions, exit codes and unchanged failures", async () => {
  await fc.assert(fc.asyncProperty(fc.record({
    baselineCode: fc.constantFrom(0, 1, 2),
    mode: fc.constantFrom("write", "missing"),
    code: fc.constantFrom(0, 1, 2, 17),
    count: fc.integer({ min: 1, max: 6 }),
  }), inspect), { seed: 215328, numRuns: 24, endOnFailure: true })
})

test("test comparison cannot discard a process failure behind unchanged assertions", () => {
  const status = fc.constantFrom("passed", "failed", "skipped", "absent")
  fc.assert(fc.property(fc.record({
    baselineCode: fc.constantFrom(0, 1, 2),
    code: fc.constantFrom(0, 1, 2, 17),
    cases: fc.array(fc.tuple(status, status), { minLength: 1, maxLength: 12 }),
  }), ({ baselineCode, code, cases }) => {
    // The oracle is the rule, case by case, not compareTests restated: every
    // case keeps its meaning. A case that passed still passes, a case fails
    // now only if it failed before, and a nonzero exit is explained by a case
    // that still fails or by a baseline that exited nonzero with none failing.
    const kept = cases.every(([before, after]) =>
      (before !== "passed" || after === "passed") && (after !== "failed" || before === "failed"))
    const failsAfter = cases.some(([, after]) => after === "failed")
    const failedBefore = cases.some(([before]) => before === "failed")
    const exitExplained = code === 0 || (baselineCode !== 0 && (failsAfter || !failedBefore))
    // A report that lost every case is a missing report, not a pass.
    const reportKept = cases.every(([before]) => before === "absent") || cases.some(([, after]) => after !== "absent")
    const tests = index => Object.fromEntries(cases.flatMap((pair, i) => pair[index] === "absent" ? [] : [["case "+i, pair[index]]]))
    assert.equal(compareTests({ code: baselineCode, tests: tests(0) }, { code, tests: tests(1) }).ok, kept && exitExplained && reportKept)
  }), { seed: 215329, numRuns: 1000, endOnFailure: true })
})

test("the two filed comparison defects fail: a passing case that becomes skipped, and a candidate with no report", () => {
  assert.equal(compareTests({ code: 0, tests: { a: "passed" } }, { code: 0, tests: { a: "skipped" } }).ok, false)
  assert.equal(compareTests({ code: 1, tests: { a: "failed", b: "passed" } }, { code: 1, tests: null }).ok, false)
  assert.equal(compareTests({ code: 1, tests: { a: "failed" } }, { code: 1, tests: null }).ok, false)
  assert.equal(compareTests({ code: 1, tests: null }, { code: 1, tests: null }).ok, true)
})
