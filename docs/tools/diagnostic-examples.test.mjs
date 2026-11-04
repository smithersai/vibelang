import assert from "node:assert/strict"
import { test } from "node:test"
import { checkExample, resolveExamples } from "./diagnostic-examples.mjs"

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
