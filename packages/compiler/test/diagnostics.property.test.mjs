import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { parseDiagnostics, styleProblems, assertFinished } from "../../../.smithers/flows/migrate/lib/diagnostics.mjs"
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const regressions = new URL("./property-regressions/", import.meta.url)
const tooling=readFileSync(join(repo,"docs/design/src/007-tooling.md"),"utf8")
const flow=readFileSync(join(repo,".smithers/flows/migrate/rules.md"),"utf8")
const quote="A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"
const tick=String.fromCharCode(96)
const flowQuote="A "+tick+"Context.Service"+tick+" class stays a class when EK4831 says it has no quick fix"
let diagnostics=""
function render(input) {
 const parts=[],expected=[]
 for(const header of input.headers) {
  parts.push((header.global?"":header.file+"("+header.line+","+header.column+"): ")+header.category+" "+header.code+": "+header.message)
  parts.push(...header.notes.map(note=>"  "+note),"unindented runner progress")
  expected.push({file:header.global?null:header.file,line:header.global?0:header.line,column:header.global?0:header.column,category:header.category,code:header.code,message:header.message,notes:header.notes})
 }
 const output=parts.map((part,i)=>part+(input.ending==="crlf"||(input.ending==="mixed"&&i%2)?String.fromCharCode(13,10):String.fromCharCode(10))).join("")
 return {output,expected}
}
test("diagnostic migration oracles quote the current specification and flow policy",()=>{
 assert.ok(tooling.includes("Every VibeLang diagnostic has a code"));assert.ok(tooling.includes(quote));assert.ok(flow.includes(flowQuote))
})
test("diagnostics retain errors, locations and notes across LF, CRLF and mixed streams",async()=>{
 await checkProperty(fc,{
  name:"migration-diagnostic-line-endings",rule:"docs/design/src/007-tooling.md: Every VibeLang diagnostic has a code; "+quote,
  command:"node --test test/diagnostics.property.test.mjs",regressions,numRuns:100,
  arbitrary:fc.record({ending:fc.constantFrom("lf","crlf","mixed"),headers:fc.array(fc.record({
   global:fc.boolean(),file:fc.constantFrom("src/testing.vibe","src/path with spaces/a.vibe","src/(generated)/a.vibe"),
   line:fc.integer({min:1,max:999}),column:fc.integer({min:1,max:999}),category:fc.constantFrom("error","warning"),
   code:fc.constantFrom("EK4831","TS2322","EK1002"),message:fc.constantFrom("Svc extends Context.Service.","The value has the wrong type."),
   notes:fc.array(fc.constantFrom("No quick fix: its members come from Shape.","Its quick fix writes the accepted form.","A second explanation."),{maxLength:3})
  }),{minLength:1,maxLength:4})}),
  diagnostics:()=>diagnostics,
  artifacts:input=>({"compiler-output.txt":render(input).output,"main.vibe":input.source||'export class Svc extends Context.Service<Svc, Shape>()("app/Svc") {}\n'}),
  check:input=>{
   const {output,expected}=render(input)
   const parsed=parseDiagnostics(output)
   diagnostics=JSON.stringify({input,expected,parsed})
   assert.deepEqual(parsed,expected,diagnostics)
   assert.doesNotThrow(()=>assertFinished({code:1,stdout:output,stderr:""}),"an ordinary diagnostic exit is not a compiler crash")
  }
 })
})
test("verify keeps refused service shapes without silencing repairable or unrelated style diagnostics",async()=>{
 await checkProperty(fc,{
  name:"opencode-refused-service-verification",rule:"docs/design/src/007-tooling.md: "+quote+"; flow rules: "+flowQuote,
  command:"node --test test/diagnostics.property.test.mjs",regressions,numRuns:100,
  arbitrary:fc.record({line:fc.integer({min:1,max:90}),column:fc.integer({min:1,max:90}),shape:fc.constantFrom("named","static","dynamic"),refused:fc.boolean(),inBatch:fc.boolean(),code:fc.constantFrom("EK4831","EK4837","EK4830","EK4832","EK4402","EK9204"),crlf:fc.boolean()}),
  diagnostics:()=>diagnostics,
  artifacts:input=>({"service.vibe":input.shape==="named"?'export interface Shape { readonly count: () => number }\nexport class Svc extends Context.Service<Svc, Shape>()("app/Svc") {}\n':input.shape==="static"?'export class Svc extends Context.Service<Svc, {}>()("app/Svc") { static readonly layer = Layer.empty }\n':'export class Svc extends Context.Service<Svc, {}>()(key) {}\n'}),
  check:input=>{
   const notes={named:"its members come from Shape; write them in the declaration.",static:"move its static members into the declaration.",dynamic:"its key is not a literal."}
   const out="src/service.vibe("+input.line+","+input.column+"): warning "+input.code+": Svc uses a TypeScript-style form.\n  "+(input.refused?"No quick fix: "+notes[input.shape]:"Its quick fix writes the accepted declaration.")+"\n"
   const parsed=parseDiagnostics(input.crlf?out.replaceAll("\n","\r\n"):out)
   const problems=styleProblems(parsed,input.inBatch?["src/service.vibe"]:["src/other.vibe"])
   const accepted=input.code==="EK4832" || (input.refused&&["EK4831","EK4837"].includes(input.code))
   diagnostics=JSON.stringify({input,parsed,problems})
   assert.equal(problems.length,input.inBatch&&!accepted?1:0,diagnostics)
   assert.equal(parsed[0].line,input.line);assert.equal(parsed[0].notes.length,1)
  }
 })
})
