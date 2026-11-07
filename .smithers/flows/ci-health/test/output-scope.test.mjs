import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, rmSync, writeFileSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { analyze, cause, collect, failedTests, report, start, targetLines } from "../lib/steps.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const fixture = new URL("../fixture-output-scope/", import.meta.url)
const labels = ["//packages:compiler-test-2", "//packages:migrate-test"]
const records = (id, label) => targetLines(readFileSync(new URL(id + "-graph.log", fixture), "utf8"), label)
const signals = [["ENOSPC", "disk full"], ["SIGKILL", "killed"], ["timed out after 5ms", "timeout"], ["ECONNRESET", "connection"]]
const outputRecord = (prefix, text) => prefix + " " + JSON.stringify(prefix === "[node-test]"
  ? { event:"output", scope:"file", stream:"stdout", file:"case.mjs", message:text }
  : { event:"failure-output", scope:"file", file:"case.mjs", output:text })

for (const label of labels) test("actual file output remains visible without assigning it to a failed test: " + label, () => {
  for (const id of ["run-01", "run-03"]) {
    const lines = records(id,label)
    assert.deepEqual(failedTests(lines),["ordinary failure"])
    assert.equal(cause(lines),"assertion")
    const output = lines.filter(line => /^\[(node-test|migrate-test)\] /.test(line))
      .map(line => JSON.parse(line.slice(line.indexOf(" ") + 1)))
      .filter(item => item.event === "output" || item.event === "failure-output")
    assert.ok(output.length > 0,"preserve captured stdout and stderr as structured output")
    assert.ok(output.every(item => item.scope === "file"))
    assert.ok(output.some(item => (item.message ?? item.output).includes("ENOSPC")))
    assert.ok(output.some(item => (item.message ?? item.output).includes("ECONNRESET")))
  }
})

test("current reporters preserve the same file-scoped messages from either possible owner", () => {
  for (const name of ["node-failures.mjs", "migrate-progress.mjs"]) {
    const outputs = []
    for (const owner of ["actual", "expected"]) {
      const reporter = fileURLToPath(new URL("../../../../scripts/testing/" + name,import.meta.url))
      const env = { ...process.env, NODE_OPTIONS:"", FORCE_COLOR:"0", CI_HEALTH_OUTPUT_OWNER:owner, CI_HEALTH_WITNESS_STATE:"fail" }
      delete env.NODE_TEST_CONTEXT
      const child = spawnSync(process.execPath,["--test","--test-reporter=" + reporter,"case.mjs"],
        { cwd:fixture, env, encoding:"utf8", timeout:10000 })
      assert.ifError(child.error)
      assert.equal(child.status,1,child.stdout + child.stderr)
      const lines = child.stdout.split("\n")
      assert.equal(cause(lines),"assertion")
      const structured = lines.filter(line => /^\[(node-test|migrate-test)\] /.test(line))
        .map(line => JSON.parse(line.slice(line.indexOf(" ") + 1)))
      if (name === "node-failures.mjs") assert.ok(structured.some(item => item.event === "diagnostic" && item.scope === "file" && item.message.includes("ENOSPC")))
      const output = structured.filter(item => item.event === "output" || item.event === "failure-output")
      assert.ok(output.length > 0)
      assert.ok(output.every(item => item.scope === "file" && item.file === "case.mjs"))
      if (name === "node-failures.mjs") assert.deepEqual(output.map(item => item.stream),["stdout","stderr"])
      outputs.push(output.map(item => item.message ?? item.output).join(""))
    }
    assert.equal(outputs[0],outputs[1],"the log cannot distinguish which test wrote these messages")
    assert.equal(outputs[0],"ENOSPC SIGKILL\nECONNRESET timed out after 5ms\n")
  }
})

test("unattributed output does not become a cause when a failure has no classified error", () => {
  for (const prefix of ["[node-test]", "[migrate-test]"]) for (const [text] of signals) {
    assert.equal(cause([outputRecord(prefix,text)]),"unknown")
    assert.equal(cause([outputRecord(prefix,text),"AssertionError: actual error"]),"assertion")
    assert.equal(cause([text]),signals.find(([s]) => s === text)[1],"legacy plain output stays supported")
  }
})

test("generated mixed file output cannot replace attributed test diagnostics", () => {
  for (const prefix of ["[node-test]", "[migrate-test]"]) {
    fc.assert(fc.property(fc.array(fc.tuple(fc.constantFrom(...signals.map(([text]) => text)),fc.boolean()), {minLength:1,maxLength:12}), fields => {
      const lines = fields.map(([text,stderr]) => outputRecord(prefix,text + (stderr ? "\nstderr" : "\nstdout")))
      const failure = prefix + " " + JSON.stringify({event:prefix === "[node-test]" ? "failure" : "test-failed", error:"AssertionError: actual error"})
      assert.equal(cause([...lines,failure]),"assertion")
      assert.equal(cause([failure,...lines]),"assertion")
    }),{seed:338,numRuns:200})
  }
})

test("collection and report retain ambiguous output causes separately from actual test errors", t => {
  const run = mkdtempSync(join(tmpdir(),"ci-health-output-scope-"))
  t.after(() => rmSync(run,{recursive:true,force:true}))
  start(run,{results:fixture.pathname,since:"",split:""})
  assert.equal(collect(run).runs.length,4)
  const result = analyze(run)
  assert.equal(result.flaky.length,2)
  for (const target of result.flaky) {
    assert.deepEqual(target.causes,{assertion:2})
    assert.deepEqual(target.unattributedCauses,{"disk full":2,killed:2,timeout:2,connection:2})
    assert.deepEqual(target.tests.map(item => item.name),["ordinary failure"])
  }
  report(run)
  const saved = JSON.parse(readFileSync(join(run,"analyze.json"),"utf8"))
  assert.deepEqual(saved.flaky,result.flaky)
  const text = readFileSync(join(run,"report.md"),"utf8")
  assert.match(text,/Unattributed output/)
  assert.match(text,/disk full 2/)
  assert.doesNotMatch(text,/Free the host|Reduce the target.s memory/)
})

test("file output mentioning a timeout does not create a duration regression", t => {
  const dir = mkdtempSync(join(tmpdir(),"ci-health-output-duration-"))
  t.after(() => rmSync(dir,{recursive:true,force:true}))
  for (let i=0;i<12;i++) {
    const source = i < 6 ? "run-02" : "run-01"
    const graph = JSON.parse(readFileSync(new URL(source + "-graph.json",fixture),"utf8"))
    for (const target of graph.results) target.durationMs = 1000
    const file = join(dir,"run-" + String(i).padStart(2,"0") + "-graph.json")
    writeFileSync(file,JSON.stringify(graph))
    const at = new Date(Date.UTC(2025,0,1,0,i))
    utimesSync(file,at,at)
    writeFileSync(file.replace(/json$/,"log"),readFileSync(new URL(source + "-graph.log",fixture)))
  }
  const run = join(dir,"analysis")
  start(run,{results:dir,since:"",split:""})
  collect(run)
  assert.deepEqual(analyze(run).regressed,[])
})

test("complete large error and file-output records remain readable", () => {
  const noise = "ordinary line\n".repeat(200000)
  for (const prefix of ["[node-test]", "[migrate-test]"]) {
    const output = outputRecord(prefix,noise + "ENOSPC")
    assert.equal(cause([output]),"unknown")
    const failure = prefix + " " + JSON.stringify({event:prefix === "[node-test]" ? "failure" : "test-failed", error:noise + "AssertionError: actual error"})
    assert.equal(cause([output,failure]),"assertion")
  }
})

test("diagnostic messages without test identity also remain unattributed", () => {
  for (const [message] of signals) {
    const line = "[node-test] " + JSON.stringify({event:"diagnostic",file:"case.mjs",message})
    assert.equal(cause([line]),"unknown")
    assert.equal(cause([line,"AssertionError: actual error"]),"assertion")
  }
})

test("possible causes preserve stream chunk boundaries without joining different origins", t => {
  const dir = mkdtempSync(join(tmpdir(),"ci-health-output-chunks-"))
  t.after(() => rmSync(dir,{recursive:true,force:true}))
  const check = (messages, expected, index) => {
    const results = join(dir,"results-" + index)
    const line = (file,stream,message) => "[node-test] " + JSON.stringify({event:"output",scope:"file",file,stream,message})
    // Hold target inputs and outcomes fixed; vary only the captured chunks.
    start(join(results,"run"),{results,since:"",split:""})
    for (const [id,status] of [["01","failed"],["02","ran"]]) {
      writeFileSync(join(results,"run-" + id + "-graph.json"),JSON.stringify({results:[{label:labels[0],key:"unchanged",status,durationMs:1}]}))
      writeFileSync(join(results,"run-" + id + "-graph.log"),messages.map(parts => labels[0] + ": " + (Array.isArray(parts) ? line(...parts) : parts)).join("\n"))
    }
    collect(join(results,"run"))
    assert.deepEqual(analyze(join(results,"run")).flaky[0].unattributedCauses,expected)
  }
  check([["a.mjs","stdout","ENO"],["b.mjs","stdout","SPC"],["a.mjs","stderr","SPC"]],{},"origins")
  check([["a.mjs","stdout","SPCENO"],"command failed (exit 1)",["a.mjs","stdout","SPCENO"]],{},"frames")
  let index=0
  fc.assert(fc.property(fc.constantFrom(...signals),fc.array(fc.integer({min:0,max:100}),{maxLength:20}), ([text,name],cuts) => {
    const points=[0,...new Set(cuts.map(cut => cut % (text.length+1))),text.length].sort((a,b) => a-b)
    const messages=points.slice(1).map((end,i) => ["case.mjs","stdout",text.slice(points[i],end)])
    check(messages,{[name]:1},index++)
  }),{seed:339,numRuns:100})
})
