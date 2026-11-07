import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { analyze, collect, failedTests, report, start, targetLines } from "../lib/steps.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const fixture = new URL("../fixture-blank-names/", import.meta.url)
const names = ["<anonymous>", " ", "\t", "\n", "\r\n", "\u2028", "\u2029", "\u00a0"]
const reporters = [["[node-test]", "failure", "//packages:compiler-test-2"], ["[migrate-test]", "test-failed", "//packages:migrate-test"]]

test("actual reporters retain anonymous and whitespace-only failure names", () => {
  for (const [, , label] of reporters) {
    const lines = targetLines(readFileSync(new URL("run-01-graph.log",fixture),"utf8"),label)
    assert.deepEqual(failedTests(lines),names)
    assert.deepEqual(failedTests(targetLines(readFileSync(new URL("run-02-graph.log",fixture),"utf8"),label)),[])
  }
})

test("generated whitespace-only names survive JSON escapes, duplicates and expected controls", () => {
  const whitespace = fc.array(fc.constantFrom(" ", "\t", "\n", "\r", "\v", "\f", "\u00a0", "\u1680", "\u2000", "\u2028", "\u2029", "\u202f", "\u205f", "\u3000", "\ufeff"),{minLength:1,maxLength:30}).map(chars=>chars.join(""))
  for (const [prefix,event] of reporters) {
    const record = item => prefix + " " + JSON.stringify({event,...item})
    fc.assert(fc.property(fc.uniqueArray(whitespace,{minLength:1,maxLength:12}),names=>{
      const lines = names.flatMap(name=>[
        record({name}),record({name}),
        record({name:"todo " + name,todo:""}),record({name:"skip " + name,skip:true})
      ])
      assert.deepEqual(failedTests(lines),names)
    }),{seed:334,numRuns:500})
  }
})

test("invalid empty and nonstring record fields remain excluded", () => {
  for (const [prefix,event] of reporters) {
    const lines = [undefined,null,17,false,{},[],""].map(name=>prefix + " " + JSON.stringify({event,name}))
    lines.push(prefix + " {",prefix + " null")
    assert.deepEqual(failedTests(lines),[])
  }
})

test("actual whitespace names retain counts through saved analysis and both report tables", t=>{
  const run=mkdtempSync(join(tmpdir(),"ci-health-blank-names-"))
  t.after(()=>rmSync(run,{recursive:true,force:true}))
  start(run,{results:fixture.pathname,since:"",split:""})
  assert.equal(collect(run).runs.length,4)
  const result=analyze(run)
  assert.equal(result.flaky.length,2)
  for (const target of result.flaky) {
    assert.deepEqual(target.tests.map(test=>test.name),names)
    assert.ok(target.tests.every(test=>test.failures===2))
  }
  assert.equal(result.intermittent.length,16)
  const saved=JSON.parse(readFileSync(join(run,"analyze.json"),"utf8"))
  assert.deepEqual(saved,result)
  const summary=report(run)
  assert.deepEqual(summary.tests,[...names,...names])
  assert.deepEqual(summary.intermittent,[...names,...names])
  const text=readFileSync(join(run,"report.md"),"utf8")
  for (const heading of ["Flaky tests","Intermittent tests"]) {
    const rows=text.split("## "+heading+"\n")[1].split("## ")[0].split("\n").filter(line=>line.startsWith("| "+String.fromCharCode(96)+"//"))
    assert.equal(rows.length,16)
    assert.ok(rows.every(row=>row.includes("</pre> | 2 | ")))
  }
})
