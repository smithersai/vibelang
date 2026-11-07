import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { failedTests, targetLines } from "../lib/steps.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
export const expected = ["structured compiler check", 'quoted "child" / Unicode ☃', "nested group", "bounded unfinished check", "Unicode \u2028 and \u2029 separators", "__proto__", "constructor", "toString", "multiline\nname\r\nwith\rcontrols | tail"]
const record = item => "[node-test] " + JSON.stringify(item)

test("real compiler reporter names nested and cancelled failures while excluding todos", () => {
  const lines = targetLines(readFileSync(new URL("../fixture-node-reporter/run-01-graph.log", import.meta.url), "utf8"), "//packages:compiler-test-2")
  assert.ok(lines.some(line => line.includes('"event":"failure"')), "use actual reporter output")
  assert.ok(lines.some(line => line.includes('"todo":""')), "actual empty todo reason")
  assert.ok(lines.some(line => line.includes('"skip":""')), "actual empty skip reason")
  assert.deepEqual(failedTests(lines), expected)
  const passing = targetLines(readFileSync(new URL("../fixture-node-reporter/run-02-graph.log", import.meta.url), "utf8"), "//packages:compiler-test-2")
  assert.ok(passing.some(line => line.includes("TODO_CONTROL")), "a todo failure is still in the real output")
  assert.deepEqual(failedTests(passing), [])
})

test("structured failure names survive generated JSON escapes, duplicates and skip/todo neighbours", () => {
  fc.assert(fc.property(fc.array(fc.record({
    name: fc.oneof(
      fc.constant("Unicode \u2028 and \u2029 separators"),
      fc.array(fc.integer({ min: 0, max: 0xffff }), { minLength: 1, maxLength: 80 }).map(units => String.fromCharCode(...units))
    ).filter(name => name.length > 0),
    event: fc.constantFrom("failure", "progress", "diagnostic", "summary"),
    todo: fc.constantFrom(false, true, "", "future control"),
    skip: fc.constantFrom(false, true, "", "skip control")
  }), { minLength: 1, maxLength: 30 }), items => {
    const lines = items.flatMap(item => [record(item), record(item)])
    const want = [...new Set(items.filter(item => item.event === "failure" && item.todo === false && item.skip === false).map(item => item.name))]
    assert.deepEqual(failedTests(lines), want)
  }), { seed: 322, numRuns: 100 })
})

test("structured records reject truncated JSON, wrong shapes and non-failure events without inventing tests", () => {
  const lines = [
    "[node-test] {", "[node-test] null", "[node-test] []", record("failure"),
    record({ event: "failure", name: 17 }), record({ event: "failure", name: "" }),
    record({ event: "summary", name: "not a test" }), record({ event: "failure" }),
    'ordinary stdout [node-test] {"event":"failure","name":"not a record"}',
    record({ event: "failure", name: 'escaped \n name " \\ ☃', todo: false, skip: false }),
    "✖ a legacy node test (2ms)", "(fail) a bun test [3.00ms]", "--- FAIL: TestGo/sub (0.01s)"
  ]
  assert.deepEqual(failedTests(lines), ['escaped \n name " \\ ☃', "a legacy node test", "a bun test", "TestGo/sub"])
})
