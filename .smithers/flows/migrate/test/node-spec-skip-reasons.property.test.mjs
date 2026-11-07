import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { assertReadableTests, readTestRun } from "../lib/test-receipts.mjs"
const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")

// Node's spec reporter (lib/internal/test_runner/reporter/utils.js, formatTestReport) writes
// `${name} (${duration_ms}ms)` and then ` # ${skip}` for a skipped test or ` # ${todo}` for a todo, where a
// non-empty string reason replaces SKIP or TODO. A skip is marked ﹣, a passing todo ✔ and a failing todo ⚠.
// The summary counts todos apart from skips; the reader folds both into skipped.
const fixture = `import { describe, it, test } from "node:test"
describe("suite", () => {
  it.skip("plain skip", () => {})
  it("reason skip", { skip: "needs a host" }, () => {})
  it("reason todo", { todo: "later" }, () => {})
  it("failing todo", { todo: "not yet" }, () => { throw new Error("x") })
  it.todo("plain todo")
  it("with (parens) in title", { skip: "x # y" }, () => {})
  it("same", () => {})
  it("same", { skip: "second copy" }, () => {})
  it("fails", () => { throw new Error("boom") })
})
test("top skip", { skip: "top reason" }, () => {})
test("issue # 12", () => {})
`
const expected = {
  "suite > plain skip": "skipped", "suite > reason skip": "skipped", "suite > reason todo": "skipped",
  "suite > failing todo": "skipped", "suite > plain todo": "skipped", "suite > with (parens) in title": "skipped",
  "suite > same": "passed", "suite > same [2]": "skipped", "suite > fails": "failed",
  "top skip": "skipped", "issue # 12": "passed",
}
const runNode = (dir, file) => {
  // Under `node --test` the child inherits NODE_TEST_CONTEXT and reports to the parent instead of printing.
  const { NODE_TEST_CONTEXT, ...env } = process.env
  const r = spawnSync(process.execPath, ["--test", "--test-reporter=spec", file], { cwd: dir, encoding: "utf8", env: { ...env, NODE_OPTIONS: "", NO_COLOR: "1" } })
  return readTestRun({ command: "node --test --test-reporter=spec " + file, output: r.stdout + r.stderr, code: r.status, root: dir })
}

test("node spec skip and todo reasons stay out of test ids and every run reads the same ids", () => {
  const dir = mkdtempSync(join(tmpdir(), "node-spec-skip-"))
  try {
    writeFileSync(join(dir, "a.test.mjs"), fixture)
    const first = runNode(dir, "a.test.mjs"), second = runNode(dir, "a.test.mjs")
    assert.doesNotThrow(() => assertReadableTests(first), JSON.stringify(first))
    assert.deepEqual(first.tests, expected)
    assert.deepEqual(second.tests, first.tests)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("a recorded Node 26 spec report with skip and todo reasons reads with stable ids", () => {
  const output = readFileSync(new URL("./corpus/smithers-node-spec-skip-reasons.txt", import.meta.url), "utf8")
  const run = readTestRun({ command: "node --test --test-reporter=spec a.test.mjs", output, code: 1, root: "/repo" })
  assert.doesNotThrow(() => assertReadableTests(run))
  assert.deepEqual(run.tests, expected)
})

test("a spec report the reader cannot attribute still fails closed", () => {
  // A describe.skip suite and a test() with subtests print like a skipped test and a describe, but Node counts
  // them the other way round, so the counts disagree and the run must stay unreadable.
  const dir = mkdtempSync(join(tmpdir(), "node-spec-skip-"))
  try {
    writeFileSync(join(dir, "b.test.mjs"), `import { describe, it, test } from "node:test"
describe.skip("skipped suite", () => { it("child", () => {}) })
test("parent", async (t) => { await t.test("kid", { skip: "kid reason" }, () => {}) })
`)
    assert.throws(() => assertReadableTests(runNode(dir, "b.test.mjs")), /summary/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("node spec reader property: duration and directive never reach the id; status follows mark and directive", () => {
  const word = fc.constantFrom("case", "(parens)", "#", "a # b", "12", "(x)", "ms", "SKIP", "TODO", "[2]", "(1s", "-")
  const name = fc.array(word, { minLength: 1, maxLength: 4 }).map(w => w.join(" "))
  const reason = fc.option(fc.array(fc.constantFrom("needs a host", "wait (5ms)", "x # y", "#", "later", "SKIP"), { minLength: 1, maxLength: 3 }).map(w => w.join(" ")), { nil: undefined })
  const kind = fc.constantFrom("pass", "fail", "skip", "todo-pass", "todo-fail")
  const ms = fc.oneof(fc.double({ min: 0.001, max: 99999, noNaN: true }).map(n => String(n)), fc.nat(5000).map(String))
  const row = fc.record({ name, reason, kind, ms, nested: fc.boolean() })
  fc.assert(fc.property(fc.array(row, { minLength: 1, maxLength: 12 }), fc.boolean(), (rows, rename) => {
    const mark = { pass: "✔", fail: "✖", skip: "﹣", "todo-pass": "✔", "todo-fail": "⚠" }
    const lines = [], want = {}, open = []
    rows.forEach((r, i) => {
      const id = r.name + " " + i
      const word = r.kind === "skip" ? "SKIP" : r.kind.startsWith("todo") ? "TODO" : undefined
      const directive = word ? " # " + (r.reason ?? word) : ""
      const ms = rename ? String(Number(r.ms) + 1) : r.ms
      if (r.nested && !open.length) { lines.push("▶ group"); open.push("group") }
      if (!r.nested && open.length) { lines.push("✔ group (" + ms + "ms)"); open.pop() }
      lines.push((r.nested ? "  " : "") + mark[r.kind] + " " + id + " (" + ms + "ms)" + directive)
      want[(r.nested ? "group > " : "") + id] = r.kind === "pass" ? "passed" : r.kind === "fail" ? "failed" : "skipped"
    })
    if (open.length) lines.push("✔ group (1ms)")
    const n = k => rows.filter(r => r.kind === k).length
    lines.push("ℹ tests " + rows.length, "ℹ pass " + n("pass"), "ℹ fail " + n("fail"), "ℹ cancelled 0", "ℹ skipped " + n("skip"), "ℹ todo " + (n("todo-pass") + n("todo-fail")))
    const run = readTestRun({ command: "node --test", output: lines.join("\n") + "\n", code: n("fail") ? 1 : 0, root: "/repo" })
    assert.doesNotThrow(() => assertReadableTests(run))
    assert.deepEqual(run.tests, want)
  }), { seed: 711071, numRuns: 300 })
})
