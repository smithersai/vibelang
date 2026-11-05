import assert from "node:assert/strict"
import { test } from "node:test"
import {readFileSync as readCaptureFixtures} from "node:fs"
import { checkExample, resolveExamples } from "./diagnostic-examples.mjs"
import {join} from "node:path"
import {archiveExamples} from "./diagnostic-archive-examples.mjs"
import {appendixCodes,repository} from "./diagnostic-identity.mjs"
import fc from "fast-check"

const example={name:"release-0011-pipe",code:"EK2301",source:"export const noTopic = 1 |> 2"}
const appendix=new Map([["EK2301","a pipe body without a topic | 23 | Running Effects |"]])
const compiler=(code,category="error")=>({status:2,stdout:"main.vibe(1,26): "+category+" "+code+": pipe body has no topic",stderr:""})

test("release-0011 fixture rejects the compiler's former EK1006 identity",()=>{
  const findings=checkExample(example,appendix,compiler("EK1006"))
  assert.equal(findings[0].kind,"example-code-mismatch")
  assert.deepEqual(findings[0].actual,[{code:"EK1006",category:"error"}])
  assert.deepEqual(checkExample(example,appendix,compiler("EK2301")),[])
})
test("the same fixture fails when its Appendix B row is missing",()=>{
  assert.equal(checkExample(example,new Map(),compiler("EK2301"))[0].kind,"example-missing-row")
})
test("right code with wrong severity, extra diagnostics or a silent compiler still fails",()=>{
  for(const result of [compiler("EK2301","warning"),{status:0,stdout:""},compiler("TS2304")])
    assert.equal(checkExample(example,appendix,result)[0].kind,"example-code-mismatch")
  assert.throws(()=>checkExample(example,appendix,{status:2,stdout:"internal compiler failure"}),/without located/)
  assert.throws(()=>checkExample(example,appendix,{status:null,signal:"SIGTERM"}),/execution failed/)
  assert.equal(checkExample(example,appendix,{status:2,stdout:compiler("EK2301").stdout+"\n"+compiler("TS2304").stdout})[0].kind,"example-code-mismatch")
})

test("a correct pipe code cannot conceal the wrong early-error meaning",()=>{
 const missing={...example,messageIncludes:"does not use its topic"}
 assert.equal(checkExample(missing,appendix,compiler("EK2301"))[0].kind,"example-meaning-mismatch")
 assert.deepEqual(checkExample(missing,appendix,{status:2,stdout:"main.vibe(1,26): error EK2301: This pipe's body does not use its topic"}),[])
})

test("executable case fixtures reject missing Appendix examples and host witnesses",()=>{
 assert.throws(()=>resolveExamples([{code:"EK2301",archive:true}],appendix),/no located Appendix example/)
 assert.throws(()=>resolveExamples([{code:"EK9998",host:true,testPath:"unused",testName:"Unused"}],appendix),/no Appendix row/)
 assert.throws(()=>resolveExamples([{code:"EK2301",host:true,testPath:"typescript/tsc/internal/vibelangmapper/project_test.go",testName:"TestThisWitnessDoesNotExist"}],appendix),/missing executable host test/)
})

test("a meaning anchor on another source diagnostic cannot hide the wrong target message",()=>{
 const target={...example,messageIncludes:"does not use its topic",at:{file:"main.vibe",line:1,column:26}}
 const result={status:2,stdout:compiler("EK2301").stdout+"\nother.vibe(2,1): error TS2304: does not use its topic"}
 assert.equal(checkExample(target,appendix,result)[0].kind,"example-meaning-mismatch")
})

test("registration-only hosts cannot silently hide unproved compiler emission",()=>{
 const fixture={code:"EK1013",host:"registration-only",emissionPending:true,testPath:"typescript/tsc/internal/vibelang/diagnostic_registered_only_hosts_test.go",testName:"TestAppendixRegisteredOnlyHostExamples"}
 assert.throws(()=>resolveExamples([fixture],new Map([["EK1013","error"]])),/missing pending emission label/)
 assert.throws(()=>resolveExamples([{...fixture,emissionPending:false}],new Map([["EK1013","error"]])),/must declare pending emission/)
 assert.throws(()=>resolveExamples([{...fixture,code:"EK9998"}],new Map([["EK9998","error: Emission witness pending for `EK9998`"]])),/missing pending emission test/)
 assert.deepEqual(resolveExamples([fixture],new Map([["EK1013","error: Emission witness pending for `EK1013`"]])),[])
})

test("retired lexical-capture and clock diagnostics require no live Appendix example and cannot be resurrected",()=>{
 const fixtures=JSON.parse(readCaptureFixtures(new URL("../../typescript/vibelang/cases/appendix-diagnostic-identities/examples.json",import.meta.url),"utf8"))
 for(const code of ["EK4405","EK4403"]){
 const fixture=fixtures.find(f=>f.code===code)
 assert.equal(fixture.retired,true)
 assert.deepEqual(resolveExamples([fixture],new Map()),[])
 assert.throws(()=>resolveExamples([fixture],new Map([[code,"error"]])),/retired fixture still has a row or registration/)
 }
})

test("current fixtures resolve and every host witness runs in the Appendix host target",()=>{
 const read=path=>readCaptureFixtures(new URL(path,import.meta.url),"utf8")
 const fixtures=JSON.parse(read("../../typescript/vibelang/cases/appendix-diagnostic-identities/examples.json"))
 assert.ok(resolveExamples(fixtures,appendixCodes(read("../design/src/900-appendices.md"))).length)
 const selected=/const specAppendixHostExamples = goVibelang\([\s\S]*?-run "([^"]+)"/.exec(read("../../PACKAGE.ts"))
 assert.ok(selected,"spec-appendix-host-examples selects tests by name")
 for(const fixture of fixtures)if(fixture.host)assert.match(fixture.testName,new RegExp(selected[1]),fixture.code)
})

// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:13:10; error; also EK0403](../../../typescript/vibelang/cases/any-call-error-recovery.fail/main.vibe).

test("the legacy any-call witness retains every co-located native throw diagnostic",()=>{
 const chapter=readCaptureFixtures(join(repository,"docs/design/src/900-appendices.md"),"utf8")
 assert.ok(chapter.includes("Replay [example: main.vibe:13:10; error; also EK0403](../../../typescript/vibelang/cases/any-call-error-recovery.fail/main.vibe)."))
 const appendix=appendixCodes(chapter)
 const [example]=archiveExamples(new Map([["EK4409",appendix.get("EK4409")]]),repository)
 assert.ok(example)
 fc.assert(fc.property(fc.boolean(),fc.boolean(),fc.integer({min:1,max:4}),(reverse,coLocated,copies)=>{
  const at=example.at
  const primary=at.file+"("+at.line+","+at.column+"): error EK4409: the legacy any-call result is not run"
  const native=at.file+"("+at.line+","+(at.column+(coLocated?0:1))+"): error EK0403: this call may throw"
  const lines=[primary,...Array(copies).fill(native)]
  if(reverse)lines.reverse()
  assert.equal(checkExample(example,appendix,{status:2,stdout:lines.join("\n")}).length===0,coLocated)
 }),{seed:4409,numRuns:100})
})

// Replay runs four single-threaded compilers. One takes about 1.3 s on a quiet
// four-core runner and about 5 s on one shared with other targets.
test("the Appendix replay budget covers every compiled example on a loaded runner",()=>{
 const read=path=>readCaptureFixtures(new URL(path,import.meta.url),"utf8")
 const fixtures=JSON.parse(read("../../typescript/vibelang/cases/appendix-diagnostic-identities/examples.json"))
 const compiled=resolveExamples(fixtures,appendixCodes(read("../design/src/900-appendices.md")))
 const budget=/const specAppendixExamples = S\.Shell\.Test\(\{[\s\S]*?timeout: "(\d+)m"/.exec(read("../../PACKAGE.ts"))
 assert.ok(budget,"spec-appendix-examples declares a timeout in minutes")
 assert.ok(Number(budget[1])*60>=compiled.length*5/4,compiled.length+" examples need more than "+budget[1]+"m")
})
