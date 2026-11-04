import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {test} from "node:test"
import assert from "node:assert/strict"
import {archiveFiles,archiveExamples} from "./diagnostic-archive-examples.mjs"
import {checkExample} from "./diagnostic-examples.mjs"
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
