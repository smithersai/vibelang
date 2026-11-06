import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { failedTests, targetLines } from "../lib/steps.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const expected = ["structured migration check", 'quoted "child" / Unicode ☃', "nested group", "bounded unfinished check"]
const record = item => "[migrate-test] " + JSON.stringify(item)

test("real migration reporter names nested and cancelled failures while excluding todos", () => {
  const lines = targetLines(readFileSync(new URL("../fixture-migrate-reporter/run-01-graph.log", import.meta.url), "utf8"), "//packages:migrate-test")
  assert.ok(lines.some(line => line.includes('"event":"test-failed"')), "use actual migration reporter output")
  assert.deepEqual(failedTests(lines), expected)
  const passing = targetLines(readFileSync(new URL("../fixture-migrate-reporter/run-02-graph.log", import.meta.url), "utf8"), "//packages:migrate-test")
  assert.ok(passing.some(line => line.includes("TODO_CONTROL")), "a todo failure remains in actual output")
  assert.deepEqual(failedTests(passing), [])
})

test("mixed reporter records preserve generated failure names without duplicates or skip/todo controls", () => {
  fc.assert(fc.property(fc.array(fc.record({
    name: fc.string({ minLength: 1, maxLength: 80 }).filter(name => name.trim().length > 0),
    kind: fc.constantFrom("migration", "compiler"),
    fails: fc.boolean(),
    todo: fc.constantFrom(false, true, "future control"),
    skip: fc.constantFrom(false, true, "skip control")
  }), { minLength: 1, maxLength: 30 }), items => {
    const lines = items.flatMap(item => {
      const prefix = item.kind === "migration" ? "[migrate-test] " : "[node-test] "
      const event = item.fails ? (item.kind === "migration" ? "test-failed" : "failure") : "progress"
      const line = prefix + JSON.stringify({ ...item, event })
      return [line, line]
    })
    const want = [...new Set(items.filter(item => item.fails && !item.todo && !item.skip).map(item => item.name))]
    assert.deepEqual(failedTests(lines), want)
  }), { seed: 619, numRuns: 100 })
})

test("migration records reject incomplete JSON, wrong shapes and other events without naming tests", () => {
  assert.deepEqual(failedTests([
    "[migrate-test] {", "[migrate-test] null", "[migrate-test] []", record("test-failed"),
    record({ event: "test-failed", name: 17 }), record({ event: "test-failed", name: "  " }),
    record({ event: "test-failed" }), record({ event: "failure", name: "wrong protocol event" }),
    '[node-test] {"event":"test-failed","name":"wrong compiler event"}',
    ...["start", "progress", "failure-output", "complete", "incomplete"].map(event => record({ event, name: "not a test" })),
    'ordinary stdout [migrate-test] {"event":"test-failed","name":"not a record"}',
    record({ event: "test-failed", name: 'escaped \n name " \\ ☃' }),
    "✖ a legacy node test (2ms)", "(fail) a bun test [3.00ms]", "--- FAIL: TestGo/sub (0.01s)"
  ]), ['escaped \n name " \\ ☃', "a legacy node test", "a bun test", "TestGo/sub"])
})
