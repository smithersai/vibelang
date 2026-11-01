import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, chmodSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { test } from "node:test"
import { readTestRun, assertReadableTests } from "../lib/test-receipts.mjs"
import { compareTests, runTests } from "../lib/tests.mjs"
import { pathReadDeferrals, rewriteReferences, restoreReferences } from "../lib/references.mjs"
import { blameCandidates } from "../lib/onepass.mjs"
import { measureTests } from "../lib/measurement.mjs"
import { emitDeclarations } from "../lib/declarations.mjs"
import { must, writeJson, readJson, quote } from "../lib/util.mjs"
const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const put = (root, file, value) => { mkdirSync(dirname(join(root,file)), {recursive:true}); writeFileSync(join(root,file),value) }
const nodeText = (marks, count = marks.length) => marks.map((m,i)=>m+" case "+i+" (1ms)").join("\n")+"\nℹ tests "+count+"\nℹ pass "+marks.filter(x=>x==="✔").length+"\nℹ fail "+marks.filter(x=>x==="✖").length+"\nℹ skipped "+marks.filter(x=>x==="﹣").length+"\nℹ cancelled 0\nℹ todo 0\n"
test("Smithers receipts reject zero tests, unexplained exits, stale JSON and dishonest summaries", () => {
  for (const [output,code] of [[nodeText([]),0],[nodeText(["✔"]),1],[nodeText(["✖"]),0],[nodeText(["✔"],2),0]]) {
    assert.throws(()=>assertReadableTests(readTestRun({command:"node --test",output,code,root:"/repo"})), /tests|summary|exit/)
  }
  const good = readTestRun({command:"node --test",output:nodeText(["✔","✖","﹣"]),code:1,root:"/repo"})
  assert.doesNotThrow(()=>assertReadableTests(good)); assert.equal(good.total,3)
  const bad = {numTotalTests:2,numPassedTests:2,numFailedTests:0,numPendingTests:0,testResults:[{name:"/repo/a.test.ts",assertionResults:[{fullName:"one",status:"passed"}]}]}
  assert.throws(()=>assertReadableTests(readTestRun({command:"vitest run",json:bad,output:"",code:0,root:"/repo"})),/summary/)
  assert.throws(()=>assertReadableTests(readTestRun({command:"vitest run",output:"",code:0,root:"/repo"})),/JSON/)
})
test("node suites and Bun results preserve per-test identity without repeated failure sections", () => {
  const output = "▶ suite\n  ✔ child (1ms)\n✔ suite (2ms)\nℹ tests 1\nℹ pass 1\nℹ fail 0\nℹ skipped 0\nℹ cancelled 0\nℹ todo 0\n"
  const node = readTestRun({command:"node --test",output,code:0,root:"/repo"})
  assert.doesNotThrow(()=>assertReadableTests(node)); assert.deepEqual(node.tests,{"suite > child":"passed"})
  const bun = readTestRun({command:"bun test",output:"a.test.ts:\n(pass) x [1ms]\n(fail) y [2ms]\n1 tests failed:\n(fail) y\n 1 pass\n 1 fail\nRan 2 tests across 1 file.\n",code:1,root:"/repo"})
  assert.doesNotThrow(()=>assertReadableTests(bun)); assert.equal(bun.total,2)
})
test("receipt fuzz: summary or exit tampering never changes a valid verdict into green", () => {
  fc.assert(fc.property(fc.array(fc.constantFrom("✔","✖","﹣"),{minLength:1,maxLength:40}), marks=>{
    const code=marks.includes("✖")?1:0
    assert.doesNotThrow(()=>assertReadableTests(readTestRun({command:"node --test",output:nodeText(marks),code,root:"/repo"})))
    assert.throws(()=>assertReadableTests(readTestRun({command:"node --test",output:nodeText(marks,marks.length+1),code,root:"/repo"})),/summary/)
    assert.throws(()=>assertReadableTests(readTestRun({command:"node --test",output:nodeText(marks),code:code?0:2,root:"/repo"})),/exit/)
  }),{seed:110713,numRuns:150})
})
test("own EK never blames dependencies; TS fallout first blames declarations that changed", () => {
  const graph = new Map([["importer.ts",["same.vibe","changed.vibe"]],["own.vibe",["changed.vibe"]],["same.vibe",[]],["changed.vibe",[]]])
  const live = new Set(["own.vibe","same.vibe","changed.vibe"]), same = new Set(["same.vibe"])
  assert.deepEqual(blameCandidates(graph,{file:"importer.ts",code:"EK4402"},live,same),[])
  assert.deepEqual(blameCandidates(graph,{file:"own.vibe",code:"EK4402"},live,same),["own.vibe"])
  assert.deepEqual(blameCandidates(graph,{file:"importer.ts",code:"TS2322"},live,same),["changed.vibe"])
  assert.deepEqual(new Set(blameCandidates(graph,{file:"importer.ts",code:"TS2322"},live,new Set([...same,"changed.vibe"]))),new Set(["same.vibe","changed.vibe"]))
})
test("detail 272 path strings use a known base; text assertions defer their source", () => {
  const root=mkdtempSync(join(tmpdir(),"migrate-driver-paths-"))
  try {
    put(root,"package.json","{}"); put(root,"src/a.ts","export const a = 1"); put(root,"src/b.ts","export const b = 1")
    const source = 'const emitted = "./a.js"\n// "./a.ts"\nconst bare = join(directory, "a.ts")\nconst local = join(import.meta.dirname, "a.ts")\nconst url = new URL("a.ts", import.meta.url)\nconst dynamic = new URL("./a.ts", base)\nconst mock = vi.mock("./a.ts")\nconst resolved = require.resolve("./a.ts")\n'
    put(root,"src/paths.ts",source)
    put(root,"tests/read.test.ts",'assert.match(readFileSync(\n new URL("../src/b.ts", import.meta.url), "utf8"), /export/)\n')
    const files=["src/a.ts","src/b.ts","src/paths.ts","tests/read.test.ts"]
    assert.deepEqual(pathReadDeferrals(root,["src/a.ts","src/b.ts"],files).map(d=>d.file),["src/b.ts"])
    const edits=rewriteReferences(root,[{from:"src/a.ts",to:"src/a.vibe"}],files)
    const result=readFileSync(join(root,"src/paths.ts"),"utf8")
    assert.match(result,/const emitted = "\.\/a.js"/)
    assert.match(result,/join\(directory, "a.ts"\)/); assert.match(result,/new URL\("\.\/a.ts", base\)/)
    assert.match(result,/dirname, "a.vibe"/); assert.match(result,/URL\("a.vibe", import.meta.url\)/)
    assert.match(result,/vi.mock\("\.\/a.vibe"\)/); assert.match(result,/require.resolve\("\.\/a.vibe"\)/)
    assert.match(result,/\/\/ "\.\/a.ts"/)
    restoreReferences(root,edits,"src/a.ts")
    assert.equal(readFileSync(join(root,"src/paths.ts"),"utf8"),source)
  } finally { if (!process.env.KEEP_DRIVER) rmSync(root,{recursive:true,force:true}); else console.log("fixture",root) }
})
test("declaration emits request deterministic single-threaded output on both sides", async () => {
  const root=mkdtempSync(join(tmpdir(),"migrate-driver-dts-"))
  try {
    put(root,"compiler.cjs",'#!/usr/bin/env node\nconst fs=require("node:fs"),p=require("node:path"); const a=process.argv.slice(2); if(!a.includes("--singleThreaded"))process.exit(7); const d=a[a.indexOf("--outDir")+1];fs.mkdirSync(d,{recursive:true});fs.writeFileSync(p.join(d,"a.d.ts"),"export declare const a: 1;")')
    chmodSync(join(root,"compiler.cjs"),0o755)
    for(const label of ["before","after"]) await emitDeclarations({compiler:join(root,"compiler.cjs"),tsconfig:"tsconfig.json",cwd:root,outDir:join(root,label)})
  } finally {rmSync(root,{recursive:true,force:true})}
})
test("one measurement job compares main and previous; a previous baseline cannot hide main regressions", async () => {
  const root=mkdtempSync(join(tmpdir(),"migrate-driver-measure-"))
  try {
    const target=join(root,"repo"),run=join(root,"run"); mkdirSync(target)
    put(target,"package.json",'{"type":"module"}')
    put(target,"a.test.mjs",'import {test} from "node:test";import assert from "node:assert/strict";test("contract",()=>assert.equal(1,1))')
    await must('jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost && jj commit -m main && jj bookmark set main -r @-',{cwd:target})
    put(target,"a.test.mjs",'import {test} from "node:test";test("contract",()=>{throw Error("regression")})')
    await must('jj commit -m previous',{cwd:target})
    const config={target,packages:[{dir:"."}],install:"true",test:{command:"node --test --test-reporter=spec a.test.mjs",cwd:"."},main:"main"}
    const result=await measureTests(config,{run,batch:"01"})
    assert.equal(result.previous.ok,true)
    assert.equal(result.main.ok,false)
    assert.equal(result.ok,false)
    assert.ok(result.job)
    assert.equal(existsSync(join(run,"measure","01","main")),false)
  } finally { if (!process.env.KEEP_DRIVER) rmSync(root,{recursive:true,force:true}); else console.log("fixture",root) }
})

test("path-string fuzz follows known directories and bulk restores exactly, keeping prose", () => {
  fc.assert(fc.property(fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/),fc.constantFrom('"',"'",'`'),(name,q)=>{
    const root=mkdtempSync(join(tmpdir(),"migrate-path-property-"))
    try {
      put(root,"package.json","{}");put(root,"src/"+name+".ts","")
      const source = "// "+name+".ts\nconst dynamic = join(directory, "+q+name+".ts"+q+")\nconst known = join(__dirname, "+q+name+".ts"+q+")\nconst prose = "+q+"the file "+name+".ts"+q+"\n"
      put(root,"src/paths.ts",source)
      const module="src/"+name+".ts",edits=rewriteReferences(root,[{from:module,to:module.replace(/\.ts$/,".vibe")}],["src/paths.ts",module])
      assert.equal(edits.length,1)
      assert.ok(readFileSync(join(root,"src/paths.ts"),"utf8").includes("directory, "+q+name+".ts"+q))
      restoreReferences(root,edits,module)
      assert.equal(readFileSync(join(root,"src/paths.ts"),"utf8"),source)
    }finally{rmSync(root,{recursive:true,force:true})}
  }),{seed:27204,numRuns:150})
})

test("migration corpus preserves a source-text reader and main's passing test",()=>{
  const corpus=readJson(new URL("./corpus/smithers-driver-rules.json",import.meta.url))
  const root=mkdtempSync(join(tmpdir(),"migrate-driver-corpus-"))
  try {
    put(root,"package.json","{}");put(root,"src/a.ts","");put(root,"src/paths.ts",corpus.pathSource)
    put(root,"tests/a.test.ts",corpus.textAssertion)
    assert.equal(pathReadDeferrals(root,["src/a.ts"],["src/paths.ts","tests/a.test.ts"]).length,1)
    assert.equal(compareTests({code:1,tests:corpus.testRegression.previous},{code:1,tests:corpus.testRegression.candidate}).ok,true)
    assert.equal(compareTests({code:0,tests:corpus.testRegression.main},{code:1,tests:corpus.testRegression.candidate}).ok,false)
  }finally{rmSync(root,{recursive:true,force:true})}
})

test("blame fuzz never attributes own EK to another module and prefers changed declarations",()=>{
  fc.assert(fc.property(fc.subarray(["a.vibe","b.vibe","c.vibe"]),fc.subarray(["a.vibe","b.vibe","c.vibe"]),(edges,identical)=>{
    const graph=new Map([["file.ts",edges],["own.vibe",edges],...edges.map(x=>[x,[]])])
    const live=new Set(["own.vibe",...edges]),same=new Set(identical)
    assert.deepEqual(blameCandidates(graph,{file:"own.vibe",code:"EK4402"},live,same),["own.vibe"])
    assert.deepEqual(blameCandidates(graph,{file:"file.ts",code:"EK4402"},live,same),[])
    const changed=edges.filter(e=>!same.has(e))
    assert.deepEqual(new Set(blameCandidates(graph,{file:"file.ts",code:"TS2322"},live,same)),new Set(changed.length?changed:edges))
  }),{seed:110714,numRuns:150})
})

test("regeneration-hook fuzz retains command order and never runs past a failed hook",async()=>{
  const {regenerate}=await import("../lib/hooks.mjs")
  await fc.assert(fc.asyncProperty(fc.array(fc.boolean(),{minLength:1,maxLength:6}),async failures=>{
    const root=mkdtempSync(join(tmpdir(),"migrate-hook-property-"))
    try {
      const config={target:root,afterConvert:failures.map((fail,i)=>"echo "+i+" >> trace; "+(fail?"exit 17":"true"))}
      const stop=failures.indexOf(true),count=stop<0?failures.length:stop+1
      const action=()=>regenerate(config,{run:join(root,"run")},"property")
      if(stop<0) assert.equal((await action()).length,count)
      else await assert.rejects(action(),/exited 17/)
      assert.deepEqual(readFileSync(join(root,"trace"),"utf8").trim().split("\n").map(Number),Array.from({length:count},(_,i)=>i))
    }finally{rmSync(root,{recursive:true,force:true})}
  }),{seed:110715,numRuns:30})
})

test("strict runs read real Bun output and cannot reuse an earlier Vitest JSON report",async()=>{
  const root=mkdtempSync(join(tmpdir(),"migrate-real-receipts-"))
  try {
    put(root,"package.json","{}")
    put(root,"value.test.ts",'import {test,expect} from "bun:test";test("value",()=>expect(1).toBe(1))\n')
    const bun=await runTests({command:"bun test",root,cwd:root,jsonFile:join(root,"bun.json"),strict:true})
    assert.doesNotThrow(()=>assertReadableTests(bun))
    assert.equal(bun.passed,1)
    put(root,"vitest","#!/bin/sh\nexit 0\n");chmodSync(join(root,"vitest"),0o755)
    const jsonFile=join(root,"vitest.json")
    writeJson(jsonFile,{numTotalTests:1,numPassedTests:1,numFailedTests:0,numPendingTests:0,testResults:[{name:join(root,"value.test.ts"),assertionResults:[{fullName:"old",status:"passed"}]}]})
    const stale=await runTests({command:quote(join(root,"vitest")),root,cwd:root,jsonFile,strict:true})
    assert.throws(()=>assertReadableTests(stale),/fresh JSON/)
    assert.equal(existsSync(jsonFile),false)
    assert.equal(stale.rerun,undefined)
  }finally{rmSync(root,{recursive:true,force:true})}
})
