import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, rmSync, writeFileSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { analyze, cause, collect, failedTests, report, start, targetLines } from "../lib/steps.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const fixture = new URL("../fixture-cause-metadata/", import.meta.url)
const labels = ["//packages:compiler-test-2", "//packages:migrate-test"]
const records = label => targetLines(readFileSync(new URL("run-01-graph.log", fixture), "utf8"), label)
const parsed = lines => lines.filter(line => /^\[(node-test|migrate-test)\] /.test(line)).map(line => ({
  prefix: line.slice(0, line.indexOf(" ")), item: JSON.parse(line.slice(line.indexOf(" ") + 1))
}))
const names = [
  "handles ENOSPC diagnostics", "handles SIGKILL diagnostics",
  "handles TimedOut: ChildProcess.spawn diagnostics", "handles timed out after diagnostics",
  "handles ECONNRESET diagnostics", "Cannot find package 'example' imported from metadata",
  "property example failed; saved metadata"
]
const signals = [
  ["property example failed; saved replay", "property counterexample"], ["ENOSPC", "disk full"],
  ["SIGKILL", "killed"], ["TimedOut: ChildProcess.spawn", "process startup"],
  ["test timed out after 5ms", "timeout"], ["ECONNRESET", "connection"],
  ["Cannot find package 'example' imported from test.mjs", "missing package"],
  ["ENOENT", "missing file"], ["AssertionError: expected two", "assertion"]
]

test("both real reporters attribute assertion errors independently of names and expected failures", () => {
  for (const label of labels) {
    const lines = records(label)
    assert.deepEqual(failedTests(lines), names)
    const failures = parsed(lines).filter(({item}) => item.event === "failure" || item.event === "test-failed")
    assert.ok(failures.some(({item}) => item.todo === "" && item.error.includes("ENOSPC")))
    assert.ok(failures.some(({item}) => item.skip === "" && item.error.includes("timed out after")))
    for (const {prefix, item} of failures.filter(({item}) => names.includes(item.name))) {
      assert.match(item.error, /AssertionError/)
      assert.equal(cause([prefix + " " + JSON.stringify(item)]), "assertion", item.name)
    }
    assert.equal(cause(lines), "assertion")
  }
})

test("generated metadata cannot change the cause of actual reporter assertion errors", () => {
  for (const label of labels) {
    const {prefix, item} = parsed(records(label)).find(({item}) => item.name === names[0])
    fc.assert(fc.property(fc.array(fc.tuple(
      fc.constantFrom(...signals.map(([text]) => text)),
      fc.string({maxLength:40})
    ), {minLength:1, maxLength:8}), fields => {
      const metadata = fields.map(([signal, extra]) => signal + extra).join("\n")
      const record = { ...item, name:metadata, file:metadata, pending:[metadata] }
      assert.equal(cause([prefix + " " + JSON.stringify(record)]), "assertion")
    }), {seed:333, numRuns:200})
  }
})

test("structured evidence retains actual error, diagnostic and captured-output causes", () => {
  for (const [prefix, event] of [["[node-test]", "failure"], ["[migrate-test]", "test-failed"]]) {
    for (const [error, expected] of signals) {
      assert.equal(cause([prefix + " " + JSON.stringify({event, name:"ordinary", file:"case.mjs", error})]), expected)
      assert.equal(cause([prefix + " " + JSON.stringify({event, error:"wrapper\n" + error + "\nend"})]), expected)
      assert.equal(cause([error]), expected, "legacy evidence")
      for (const flag of ["todo", "skip"]) for (const value of [true, "", "expected"]) {
        const control = prefix + " " + JSON.stringify({event, error, [flag]:value})
        assert.equal(cause([control, "AssertionError: actual failure"]), "assertion")
      }
    }
  }
  assert.equal(cause(['[node-test] ' + JSON.stringify({event:"diagnostic", file:"ENOSPC", message:"ECONNRESET"})]), "connection")
  assert.equal(cause(['[migrate-test] ' + JSON.stringify({event:"failure-output", file:"SIGKILL", output:"ENOSPC"})]), "disk full")
  const hash = "ab".repeat(32)
  const archive = "parser.go:1:2: could not import example (open cache/ab/" + hash + "-d: no such file or directory)"
  assert.equal(cause(['[node-test] ' + JSON.stringify({event:"failure", error:"wrapper\n" + archive})]), "Go cache archive")
})

test("progress metadata and incomplete structured records supply no failure-cause evidence", () => {
  for (const prefix of ["[node-test]", "[migrate-test]"]) {
    for (const event of ["start", "progress", "summary", "complete", "incomplete", "unknown"]) {
      assert.equal(cause([prefix + " " + JSON.stringify({event, file:"ENOSPC", name:"SIGKILL", pending:["ECONNRESET"], error:"test timed out after 5ms"})]), "unknown")
    }
    for (const text of ['{"event":"failure","name":"ENOSPC"', "null", "[]", '"ENOSPC"']) {
      assert.equal(cause([prefix + " " + text]), "unknown")
    }
  }
})

test("real cause fixture survives collection, saved analysis and both report tables", t => {
  const run = mkdtempSync(join(tmpdir(), "ci-health-cause-metadata-"))
  t.after(() => rmSync(run,{recursive:true,force:true}))
  start(run, {results:fixture.pathname,since:"",split:""})
  assert.equal(collect(run).runs.length,4)
  const result = analyze(run)
  assert.equal(result.flaky.length,2)
  for (const target of result.flaky) {
    assert.deepEqual(target.causes,{assertion:2})
    assert.deepEqual(target.tests.map(test => test.name),names)
    assert.ok(target.tests.every(test => test.failures === 2))
  }
  assert.equal(result.intermittent.length,14)
  report(run)
  assert.deepEqual(JSON.parse(readFileSync(join(run,"analyze.json"))).flaky.map(target => target.causes),[{assertion:2},{assertion:2}])
  const text = readFileSync(join(run,"report.md"),"utf8")
  assert.match(text,/assertion 2/)
  assert.doesNotMatch(text,/Free the host|Reduce the target.s memory/)
})

test("metadata and expected deadlines do not create a duration regression", t => {
  const dir = mkdtempSync(join(tmpdir(), "ci-health-cause-duration-"))
  t.after(() => rmSync(dir,{recursive:true,force:true}))
  for (let i=0;i<12;i++) {
    const source = i < 6 ? "run-02" : "run-01"
    const graph = JSON.parse(readFileSync(new URL(source + "-graph.json",fixture),"utf8"))
    for (const target of graph.results) target.durationMs = 1000
    const file = join(dir,"run-" + String(i).padStart(2,"0") + "-graph.json")
    writeFileSync(file,JSON.stringify(graph))
    const at = new Date(Date.UTC(2025,0,1,0,i))
    utimesSync(file,at,at)
    writeFileSync(file.replace(/json$/, "log"),readFileSync(new URL(source + "-graph.log",fixture)))
  }
  const run = join(dir,"analysis")
  start(run,{results:dir,since:"",split:""})
  collect(run)
  assert.deepEqual(analyze(run).regressed,[])
})
