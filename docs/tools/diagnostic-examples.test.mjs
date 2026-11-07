import assert from "node:assert/strict"
import { test } from "node:test"
import {readFileSync as readCaptureFixtures} from "node:fs"
import { checkExample, resolveExamples } from "./diagnostic-examples.mjs"
import {join} from "node:path"
import {archiveExamples} from "./diagnostic-archive-examples.mjs"
import {appendixCodes,appendixCategory,repository} from "./diagnostic-identity.mjs"
import fc from "fast-check"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"

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
 const fixture={code:"EK4406",host:"registration-only",emissionPending:true,testPath:"typescript/tsc/internal/vibelang/diagnostic_registered_only_hosts_test.go",testName:"TestAppendixRegisteredOnlyHostExamples"}
 assert.throws(()=>resolveExamples([fixture],new Map([["EK4406","error"]])),/missing pending emission label/)
 assert.throws(()=>resolveExamples([{...fixture,emissionPending:false}],new Map([["EK4406","error"]])),/must declare pending emission/)
 assert.throws(()=>resolveExamples([{...fixture,code:"EK9998"}],new Map([["EK9998","error: Emission witness pending for `EK9998`"]])),/missing pending emission test/)
 assert.deepEqual(resolveExamples([fixture],new Map([["EK4406","error: Emission witness pending for `EK4406`"]])),[])
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

// rule-evidence: docs/design/src/900-appendices.md | The old `EK4704` is retired and will never be reassigned: VIP-7 admits computed property-key expressions under the pinned pattern grammar.

test("the computed-key limitation diagnostic stays retired",()=>{
 const chapter=readCaptureFixtures(join(repository,"docs/design/src/900-appendices.md"),"utf8")
 assert.ok(!appendixCodes(chapter).has("EK4704"))
 assert.ok(chapter.includes("The old `EK4704` is retired and will never be reassigned"))
 const fixtures=JSON.parse(readCaptureFixtures(join(repository,"typescript/vibelang/cases/appendix-diagnostic-identities/examples.json"),"utf8"))
 const fixture=fixtures.find(example=>example.code==="EK4704")
 assert.equal(fixture?.retired,true)
 assert.equal(fixture?.archive,undefined)
 assert.deepEqual(resolveExamples([fixture],new Map()),[])
 assert.throws(()=>resolveExamples([fixture],new Map([["EK4704","error"]])),/retired fixture still has a row or registration/)
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

 
test("registration-only replays require a documented native case and its exact expected diagnostics", t => {
 const root=mkdtempSync(join(tmpdir(),"appendix-emission-replay-"))
 t.after(()=>rmSync(root,{recursive:true,force:true}))
 const project="typescript/vibelang/cases/archived-control.fail"
 mkdirSync(join(root,project),{recursive:true})
 writeFileSync(join(root,project,"main.vibe"),"// expect: EK3501\ncontrol Ask { ask(): number!! }\n")
 writeFileSync(join(root,"host.go"),"func TestRegistry(t *testing.T) {}")
 const fixture={code:"EK4201",host:"registration-only",testPath:"host.go",testName:"TestRegistry",
  emissionReplay:{project,code:"EK3501"}}
 const rows=new Map([["EK4201","error: `EK4201` archived input reports `EK3501`; [emission replay](../../../"+project+"/main.vibe)"],["EK3501","error"]])
 const [example]=resolveExamples([fixture],rows,root)
 assert.equal(example.code,"EK3501")
 assert.equal(example.name,"appendix-current-emission-EK4201")
 assert.equal(example.project,join(root,project))
 assert.throws(()=>resolveExamples([{...fixture,emissionReplay:undefined}],rows,root),/must declare pending emission or an emission replay/)
 assert.throws(()=>resolveExamples([{...fixture,emissionPending:true}],rows,root),/exclusively/)
 for(const project of ["../outside","typescript/vibelang/cases/../outside","typescript/vibelang/cases"]){
  assert.throws(()=>resolveExamples([{...fixture,emissionReplay:{project,code:"EK3501"}}],rows,root),/must name a native case/)
 }
 assert.throws(()=>resolveExamples([fixture],new Map([["EK4201","error"],["EK3501","error"]]),root),/lacks its Appendix link/)
 assert.throws(()=>resolveExamples([{...fixture,emissionReplay:{project,code:"EK4201"}}],rows,root),/differs from its case expectations/)
 writeFileSync(join(root,project,"main.vibe"),"// expect: EK3501 TS2304\ncontrol Ask {}\n")
 assert.throws(()=>resolveExamples([fixture],rows,root),/differs from its case expectations/)
 const warningRows=new Map([...rows,["EK4856","warning"]])
 const withWarning={...fixture,emissionReplay:{...fixture.emissionReplay,also:["EK4856"]}}
 writeFileSync(join(root,project,"main.vibe"),"// expect: EK3501\n// expect-warnings: EK4856\ncontrol Ask {}\n")
 assert.equal(resolveExamples([withWarning],warningRows,root).length,1)
 writeFileSync(join(root,project,"main.vibe"),"// expect: EK3501 EK4856\ncontrol Ask {}\n")
 assert.throws(()=>resolveExamples([withWarning],warningRows,root),/differs from its case expectations/)
})

// Appendix B retains interim registrations separately from current emitted diagnostics.
test("fast-check: completed emission replays reject legacy codes, wrong severity and extra diagnostics",()=>{
 const chapter=readCaptureFixtures(join(repository,"docs/design/src/900-appendices.md"),"utf8")
 const appendix=appendixCodes(chapter)
 const allFixtures=JSON.parse(readCaptureFixtures(join(repository,"typescript/vibelang/cases/appendix-diagnostic-identities/examples.json"),"utf8"))
 const fixtures=allFixtures.filter(f=>f.emissionReplay)
 assert.equal(fixtures.length,7)
 const resolved=resolveExamples(allFixtures,appendix)
 const examples=fixtures.map(f=>({fixture:f,example:resolved.find(e=>e.name==="appendix-current-emission-"+f.code)}))
 fc.assert(fc.property(fc.constantFrom(...examples),fc.boolean(),fc.integer({min:1,max:4}),({fixture,example},reverse,copies)=>{
  const diagnostic=(code,category="error")=>"main.vibe(1,1): "+category+" "+code+": current replay"
  const lines=[example.code,...example.also??[]].flatMap(code=>Array(copies).fill(diagnostic(code,code.startsWith("TS")?"error":appendixCategory(appendix.get(code)))))
  if(reverse)lines.reverse()
  assert.deepEqual(checkExample(example,appendix,{status:2,stdout:lines.join("\n")}),[])
  assert.ok(checkExample(example,appendix,{status:2,stdout:lines.join("\n")+"\n"+diagnostic("TS9999")}).length)
  assert.ok(checkExample(example,appendix,{status:2,stdout:lines.map(line=>line.replace(": error ",": warning ")).join("\n")}).length)
  if(fixture.code!==example.code){
   assert.ok(checkExample(example,appendix,{status:2,stdout:lines.join("\n")+"\n"+diagnostic(fixture.code)}).length)
  }
 }),{seed:42014202,numRuns:140})
})
