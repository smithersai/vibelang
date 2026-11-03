import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { upgradeEffect } from "../lib/steps.mjs"
import * as Jj from "../lib/jj.mjs"
import { must } from "../lib/util.mjs"
const corpus=JSON.parse(readFileSync(new URL("./corpus/foldkit-mcp-build-prerequisites.json",import.meta.url)))
async function fixture(root, fail = false) {
  const target=join(root,"repo"),toolchain=join(root,"toolchain")
  const put=(file,text)=>{mkdirSync(dirname(join(target,file)),{recursive:true});writeFileSync(join(target,file),text)}
  put("package.json",JSON.stringify({...corpus.root,...(fail?{scripts:{"build:packages":"node -e 'process.exit(7)'"}}:{})}))
  put("bun.lock","")
  put(".gitignore","**/dist/\nnode_modules/\ntrace.log\n")
  put("packages/core/package.json",JSON.stringify({version:"1.0.0",...corpus.packages["packages/core"]}))
  put("packages/mcp/package.json",JSON.stringify({version:"1.0.0",...corpus.packages["packages/mcp"]}))
  const script=(name,dependency)=>'import {existsSync,mkdirSync,writeFileSync,readFileSync,appendFileSync} from "node:fs";\n'+(dependency?'if(!existsSync("../core/dist/index.js")) process.exit(3);\n':"")+'mkdirSync("dist",{recursive:true});writeFileSync("dist/'+(name==="core"?"index":"server")+'.js",readFileSync("source.txt"));appendFileSync("../../trace.log",'+JSON.stringify(name+"\n")+');\n'
  put("packages/core/build.mjs",script("core",false));put("packages/mcp/build.mjs",script("mcp",true))
  put("packages/core/source.txt","original-core");put("packages/mcp/source.txt","original-server")
  put("packages/mcp/main.test.ts",'import {test,expect} from "bun:test"; import {existsSync} from "node:fs"; test("original stdio distribution is prepared",()=>{ expect(existsSync("dist/server.js")).toBe(true); expect(existsSync("../core/dist/index.js")).toBe(true) })\n')
  await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost",{cwd:target})
  const base=await Jj.commit(target,"original source")
  mkdirSync(toolchain);writeFileSync(join(toolchain,"toolchain.json"),JSON.stringify({version:"0.0.11",effect:"4.0.6",compiler:"native/vibelang",packages:{}}))
  return {target,toolchain,base,run:join(root,"run"),packages:["packages/mcp"],test:"bun test",testCwd:"packages/mcp",testReport:"^\\((?<status>pass|fail)\\) (?<name>.+?)(?: \\[[^\\]]*\\])?$",install:"true"}
}
test("foldkit: upgrade prepares dependency and package distributions before both baselines",async()=>{
  const root=mkdtempSync(join(tmpdir(),"migrate-build-prerequisites-"))
  try {
    const options=await fixture(root), result=await upgradeEffect(options)
    assert.equal(result.tests.code,0,"missing builds must never become accepted baseline failures")
    assert.equal(result.tests.failed.length,0)
    assert.deepEqual(readFileSync(join(options.target,"trace.log"),"utf8").trim().split("\n"),["core","mcp","core","mcp"])
    const upstream=JSON.parse(readFileSync(join(options.run,"baseline/logs/upstream-build.json")))
    assert.equal(upstream.state,"complete")
    assert.ok(upstream.sourceCommit)
    assert.ok(upstream.dependenciesHash)
    assert.deepEqual(upstream.steps.map(s=>s.code),[0,0])
    assert.ok(upstream.steps.every(s=>s.finishedAt && s.startedAt && s.durationMs>=0))
  } finally {rmSync(root,{recursive:true,force:true})}
})
test("failed build preparation stays durable and cannot create a test baseline",async()=>{
  const root=mkdtempSync(join(tmpdir(),"migrate-build-failure-"))
  try {
    const options=await fixture(root,true)
    await assert.rejects(upgradeEffect(options),/build prerequisite failed/)
    const receipt=JSON.parse(readFileSync(join(options.run,"baseline/logs/upstream-build.json")))
    assert.equal(receipt.state,"failed")
    assert.equal(receipt.steps[0].code,7)
    assert.equal(existsSync(join(options.run,"baseline/upstream-tests.json")),false)
  } finally {rmSync(root,{recursive:true,force:true})}
})
test("candidate builds refresh stale distributions and retain exact source and dependency identities",async()=>{
  const {prepareBuilds}=await import("../lib/builds.mjs")
  const {makeConfig}=await import("../lib/steps.mjs")
  const root=mkdtempSync(join(tmpdir(),"migrate-build-candidate-"))
  try {
    const options=await fixture(root),config=makeConfig(options),logs=join(options.run,"logs")
    const before=await prepareBuilds(config,logs,"baseline")
    writeFileSync(join(options.target,"packages/mcp/source.txt"),"changed-server")
    const candidate=await prepareBuilds(config,logs,"candidate")
    assert.equal(readFileSync(join(options.target,"packages/mcp/dist/server.js"),"utf8"),"changed-server")
    assert.notEqual(candidate.sourceCommit,before.sourceCommit)
    assert.equal(candidate.dependenciesHash,before.dependenciesHash)
    assert.equal(candidate.state,"complete")
    assert.ok(candidate.steps.every(s=>s.code===0 && s.signal===null))
  } finally {rmSync(root,{recursive:true,force:true})}
})
test("verify refuses an old failing baseline without build provenance instead of hiding it behind a clean candidate",async()=>{
  const {makeConfig,paths,verify}=await import("../lib/steps.mjs")
  const require=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))
  const root=mkdtempSync(join(tmpdir(),"migrate-unprepared-baseline-"))
  try {
    const options=await fixture(root),config=makeConfig(options),p=paths(options.run)
    const put=(file,text)=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text)}
    mkdirSync(join(options.target,"node_modules"))
    symlinkSync(dirname(require.resolve("typescript/package.json")),join(options.target,"node_modules/typescript"))
    put(join(options.toolchain,"native/vibelang"),"#!/bin/sh\nexit 0\n")
    const {chmodSync}=await import("node:fs");chmodSync(join(options.toolchain,"native/vibelang"),0o755)
    put(join(options.target,"packages/mcp/src/main.vibe"),"export const native=1")
    put(join(options.target,"packages/mcp/tsconfig.json"),'{"files":["src/main.vibe"]}')
    const manifest=JSON.parse(readFileSync(join(options.target,"packages/mcp/package.json")));manifest.private=true
    put(join(options.target,"packages/mcp/package.json"),JSON.stringify(manifest))
    put(p.config,JSON.stringify(config))
    put(p.plan,JSON.stringify({batches:[{files:["packages/mcp/src/main.ts"]}]}))
    put(join(p.baseline,"compile-packages__mcp.json"),"[]")
    put(join(p.baseline,"tests.json"),JSON.stringify({code:1,tests:{"original stdio distribution is prepared":"failed"}}))
    const result=await verify({run:options.run,batch:"01"})
    assert.equal(result.tests.code,0)
    assert.equal(result.checks.baselinePrepared,false)
    assert.equal(result.ok,false)
  } finally {rmSync(root,{recursive:true,force:true})}
})

const fc=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))("fast-check")
const {runMeasurementJob}=await import("../lib/measurement.mjs")
const measurementCorpus=corpus.measurement
test("foldkit: each measurement side rebuilds stale outputs after install and before tests",async()=>{
 await fc.assert(fc.asyncProperty(fc.shuffledSubarray(measurementCorpus.sides,{minLength:3,maxLength:3}),fc.integer({min:0,max:10000}),async(order,seed)=>{
  const root=mkdtempSync(join(tmpdir(),"measurement-build-"))
  try {
   const out=join(root,"out");mkdirSync(out)
   const sides=order.map(name=>{
    const target=join(root,name);mkdirSync(target);mkdirSync(join(target,"dist"))
    writeFileSync(join(target,"package.json"),JSON.stringify({private:true,scripts:{build:"node build.mjs"}}))
    writeFileSync(join(target,"source.txt"),name+seed)
    writeFileSync(join(target,"dist/server.js"),measurementCorpus.stale)
    writeFileSync(join(target,"build.mjs"),'import{readFileSync,writeFileSync,existsSync}from"node:fs";if(!existsSync("installed"))process.exit(3);writeFileSync("dist/server.js",readFileSync("source.txt"))')
    writeFileSync(join(target,"test.mjs"),'import{readFileSync}from"node:fs";if(readFileSync("source.txt","utf8")!==readFileSync("dist/server.js","utf8"))process.exit(4);console.log("PASS distribution")')
    return {name,target,install:"node -e "+JSON.stringify('require("node:fs").writeFileSync("installed","yes")')}
   })
   await runMeasurementJob({job:"build-"+seed,out,sides,test:{command:"node test.mjs",report:"^(?<status>PASS) (?<name>.+)$"},build:{packages:[{dir:"."}],toolchain:{kind:"registry"}}})
   const result=JSON.parse(readFileSync(join(out,"receipts.json")))
   for(const side of sides){
    assert.equal(result.receipts[side.name].code,0)
    assert.equal(result.builds[side.name].state,"complete")
    assert.equal(readFileSync(join(side.target,"dist/server.js"),"utf8"),side.name+seed)
   }
  }finally{rmSync(root,{recursive:true,force:true})}
 }),{numRuns:12})
})
test("a failed measurement-side build cannot produce test receipts",async()=>{
 const root=mkdtempSync(join(tmpdir(),"measurement-build-fail-"))
 try{
  writeFileSync(join(root,"package.json"),JSON.stringify({scripts:{build:"node -e 'process.exit(7)'"}}))
  await assert.rejects(runMeasurementJob({job:"fail",out:root,sides:[{name:"candidate",target:root}],test:{command:"node -e 'console.log(1)'",report:"x"},build:{packages:[{dir:"."}],toolchain:{kind:"registry"}}}),/build prerequisite failed/)
  assert.equal(existsSync(join(root,"receipts.json")),false)
  assert.equal(JSON.parse(readFileSync(join(root,"candidate-build.json"))).state,"failed")
 }finally{rmSync(root,{recursive:true,force:true})}
})
