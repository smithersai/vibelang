// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | Example: `catch (cause: Cause.Cause<E>) { recover(cause) }` in legacy effect code Replay [example: main.vibe:13:19](../../../typescript/vibelang/cases/primitives.fail/main.vibe).
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {test} from "node:test"
import assert from "node:assert/strict"
import {archiveFiles,archiveExamples} from "./diagnostic-archive-examples.mjs"
import {checkExample} from "./diagnostic-examples.mjs"
import {appendixCodes,repository} from "./diagnostic-identity.mjs"
import fc from "fast-check"
test("archive examples retain their configuration and reject escaping or duplicate paths",()=>{
 assert.deepEqual(archiveFiles("-- main.vibe --\nconst n=1\n-- tsconfig.json --\n{}\n"),{"main.vibe":"const n=1\n","tsconfig.json":"{}\n"})
 assert.throws(()=>archiveFiles("-- ../escape --\nx"),/unsafe/)
 assert.throws(()=>archiveFiles("-- /escape --\nx"),/unsafe/)
 assert.throws(()=>archiveFiles("-- main.vibe --\nx\n-- main.vibe --\ny"),/duplicate/)
})
test("a located example still rejects a wrong identity despite unrelated diagnostics elsewhere",()=>{
 const example={name:"located",code:"EK1017",at:{file:"main.vibe",line:2,column:3}}
 const appendix=new Map([["EK1017","provide expression"]])
 const response=code=>({status:2,stdout:"main.vibe(1,1): error TS2304: other\nmain.vibe(2,3): error "+code+": expression"})
 assert.deepEqual(checkExample(example,appendix,response("EK1017")),[])
 assert.equal(checkExample(example,appendix,response("EK2301"))[0].kind,"example-code-mismatch")
 assert.equal(checkExample(example,appendix,{status:2,stdout:"main.vibe(1,1): error EK1017: wrong location"})[0].kind,"example-code-mismatch")
})

test("companion diagnostics cannot replace the row's own identity",()=>{
 const appendix=new Map([["EK2118","legacy subclass"],["EK2117","extends"]])
 const example={name:"subclass",code:"EK2118",also:["EK2117"]}
 const result={status:2,stdout:"main.vibe(1,1): error EK2117: extends"}
 assert.equal(checkExample(example,appendix,result)[0].kind,"example-code-mismatch")
 result.stdout+="\nmain.vibe(1,1): error EK2118: constructor"
 assert.deepEqual(checkExample(example,appendix,result),[])
})

test("a malformed Appendix example cannot silently disappear from the probes",()=>{
 assert.throws(()=>archiveExamples(new Map([["EK1001","[example: missing-location](x)"]]),"/tmp"),/malformed/)
})

test("the Appendix runner decodes actual Go corpus envelopes before reading archive paths",()=>{
 const archive="-- main.vibe --\nexport const n = 1\n"
 assert.deepEqual(archiveFiles("go test fuzz v1\nstring("+JSON.stringify(archive)+")\n"),{"main.vibe":"export const n = 1\n"})
 assert.throws(()=>archiveFiles("go test fuzz v1\nint(1)\n"),/one fuzz string/)
})


test("a located severity mismatch cannot disappear behind a category filter",()=>{
 const example={name:"severity",code:"EK1017",at:{file:"main.vibe",line:2,column:3,category:"error"}}
 const appendix=new Map([["EK1017","error: provide expression"]])
 assert.equal(checkExample(example,appendix,{status:0,stdout:"main.vibe(2,3): warning EK1017: expression"})[0].kind,"example-code-mismatch")
})


test("native case links retain project context and enforce documented overrides",()=>{
 const root=mkdtempSync(join(tmpdir(),"appendix-case-"))
 try {
  const dir=join(root,"typescript/vibelang/cases/example.fail");mkdirSync(dir,{recursive:true})
  writeFileSync(join(dir,"main.vibe"),"export const n=1")
  writeFileSync(join(dir,"tsconfig.json"),JSON.stringify({compilerOptions:{vibelang:{diagnostics:{EK4811:"error"}}}}))
  const row="[example: main.vibe:1:1; error](../../../typescript/vibelang/cases/example.fail/main.vibe)"
  const examples=archiveExamples(new Map([["EK4811",row]]),root)
  assert.equal(examples[0].project,dir)
  assert.equal(examples[0].exampleCategory,"error")
  assert.throws(()=>archiveExamples(new Map([["EK4811",row.replace("; error","")]]),root),/configured severity/)
  assert.throws(()=>archiveExamples(new Map([["EK4811",row.replace("main.vibe:","other.vibe:")]]),root),/located source/)
 } finally {rmSync(root,{recursive:true,force:true})}
})

test("the published Cause-catch witness keeps its unmigrated annotation at the cited position",()=>{
 const root=repository
 const appendix=appendixCodes(readFileSync(join(root,"docs/design/src/900-appendices.md"),"utf8"))
 const examples=archiveExamples(new Map([["EK2113",appendix.get("EK2113")]]),root)
 assert.equal(examples.length,1)
 const example=examples[0],line=example.files[example.at.file].split("\n")[example.at.line-1]
 assert.match(line.slice(0,example.at.column-1),/catch\s*\(\s*\w+:\s*$/)
 assert.match(line.slice(example.at.column-1),/^Cause(?:\.Cause)?(?:<[^>]+>)?/)
 fc.assert(fc.property(fc.integer({min:-1,max:3}),fc.integer({min:-3,max:3}),(row,column)=>{
  const result={status:0,stdout:example.at.file+"("+example.at.line+","+example.at.column+"): warning EK2113: legacy Cause catch"}
  const shifted={...example,at:{...example.at,line:example.at.line+row,column:example.at.column+column}}
  assert.equal(checkExample(shifted,appendix,result).length===0,row===0&&column===0)
 }),{seed:2113,numRuns:100})
})

test("mixed platform imports document both errors at their shared source location",()=>{
 const appendix=appendixCodes(readFileSync(join(repository,"docs/design/src/900-appendices.md"),"utf8"))
 const [example]=archiveExamples(new Map([["EK3206",appendix.get("EK3206")]]),repository)
 assert.deepEqual(example.also,["EK2601"])
 fc.assert(fc.property(fc.boolean(),fc.boolean(),fc.boolean(),(retirement,mixed,reverse)=>{
  const codes=[...(retirement?["EK2601"]:[]),...(mixed?["EK3206"]:[])]
  if(reverse)codes.reverse()
  const stdout=codes.map(code=>example.at.file+"("+example.at.line+","+example.at.column+"): error "+code+": invalid legacy platform import").join("\n")
  assert.equal(checkExample(example,appendix,{status:codes.length?2:0,stdout}).length===0,retirement&&mixed)
 }),{seed:3206,numRuns:40})
})
