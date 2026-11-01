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
    assert.equal(compareTests(baseline, current).ok, !(input.baselineCode === 0 && input.code !== 0),
      "a nonzero command must regress a passing baseline even when every reported assertion passed")
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
    const tests = index => Object.fromEntries(cases.flatMap((pair, i) => pair[index] === "absent" ? [] : [["case "+i, pair[index]]]))
    const before = tests(0), after = tests(1)
    const expected = !(baselineCode === 0 && code !== 0)
      && !Object.entries(after).some(([name, value]) => value === "failed" && before[name] !== "failed")
      && !Object.entries(before).some(([name, value]) => value === "passed" && !(name in after))
    assert.equal(compareTests({ code: baselineCode, tests: before }, { code, tests: after }).ok, expected)
  }), { seed: 215329, numRuns: 1000, endOnFailure: true })
})
