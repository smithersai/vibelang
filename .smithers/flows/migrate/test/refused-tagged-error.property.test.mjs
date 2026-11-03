import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {existsSync,readFileSync,mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync,realpathSync} from "node:fs"
import {createRequire} from "node:module"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
import {test} from "node:test"
const repo=fileURLToPath(new URL("../../../../",import.meta.url))
const require=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))
const fc=require("fast-check")
const {parseDiagnostics,styleProblems}=await import(process.env.REFUSED_TAGGED_ERROR_GATE_UNDER_TEST||new URL("../lib/diagnostics.mjs",import.meta.url).href)
const corpus=JSON.parse(readFileSync(new URL("./corpus/alchemy-refused-tagged-error.json",import.meta.url),"utf8"))

const rule="A `Data.TaggedError` class stays a class when EK4830 says it has no quick fix"
test("the retained-tag contract is recorded in migration rules",()=>{assert.ok(readFileSync(new URL("../rules.md",import.meta.url),"utf8").includes(rule))})
test("Alchemy: a refused published TaggedError tag stays out of the style gate",()=>{
 assert.deepEqual(styleProblems(parseDiagnostics(corpus.output),["main.vibe"]),[])
 const control=parseDiagnostics(corpus.output.replaceAll("EK4830","EK4831"))
 assert.deepEqual(styleProblems(control,["main.vibe"]),[])
})
test("a refusal exempts only its diagnostic, code and selected file",()=>{
 const ds=parseDiagnostics(corpus.output+"main.vibe(4,1): warning EK4830: repairable class.\n  Its quick fix writes an error.\nmain.vibe(5,1): warning EK4835: unrelated style.\n  No quick fix: keep this.\nmain.vibe(6,1): error EK4402: forbidden global.\n  No quick fix: keep this.\n")
 assert.deepEqual(styleProblems(ds,["main.vibe"]).map(d=>d.code),["EK4830","EK4835","EK4402"])
 assert.deepEqual(styleProblems(ds,["other.vibe"]),[])
})
test("the current compiler keeps the minimized Alchemy class and its published tag",()=>{
 const binary=process.env.VIBELANG_BINARY||[join(repo,"packages/compiler/native/vibelang"),join(repo,"typescript/built/local/tsc")].find(existsSync)
 assert.ok(binary,"provide the built compiler for the migration witness")
 const dir=realpathSync(mkdtempSync(join(tmpdir(),"alchemy-tag-refusal-")))
 try{
  mkdirSync(join(dir,"node_modules"))
  symlinkSync(realpathSync(join(process.env.EFFECT_NODE_MODULES||join(repo,"experiments/node_modules"),"effect")),join(dir,"node_modules/effect"))
  symlinkSync(join(repo,"packages/runtime"),join(dir,"node_modules/vibelang-runtime"))
  writeFileSync(join(dir,"package.json"),'{"type":"module"}')
  writeFileSync(join(dir,"main.vibe"),corpus.vibe)
  writeFileSync(join(dir,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"ES2022",module:"NodeNext",strict:true,skipLibCheck:true,noEmit:true,types:[]},files:["main.vibe"]}))
  const r=spawnSync(binary,["-p",".","--fix","--noEmit","--pretty","false"],{cwd:dir,encoding:"utf8",timeout:120000})
  assert.equal(r.status,0,r.stdout+r.stderr)
  const result=spawnSync(binary,["-p",".","--noEmit","--pretty","false"],{cwd:dir,encoding:"utf8",timeout:120000})
  assert.equal(result.status,0,result.stdout+result.stderr)
  const ds=parseDiagnostics(result.stdout+result.stderr)
  assert.ok(ds.some(d=>d.code==="EK4830"&&d.notes.some(n=>n.startsWith("No quick fix"))))
  assert.deepEqual(styleProblems(ds,["main.vibe"]),[])
  const fixed=readFileSync(join(dir,"main.vibe"),"utf8")
  assert.ok(fixed.includes("class BucketNotCreated"))
  assert.ok(fixed.includes('"Railway.BucketNotCreated"'))
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test("property: retained tags match refused service handling without hiding other findings",()=>{
 const eligible=["EK4805","EK4830","EK4831","EK4837"]
 fc.assert(fc.property(fc.record({
  code:fc.constantFrom(...eligible,"EK4835","EK4836","EK4838","EK4402","EK9204"),
  directory:fc.integer({min:0,max:30}),line:fc.integer({min:1,max:200}),column:fc.integer({min:1,max:100}),
  refused:fc.boolean(),selected:fc.boolean(),newline:fc.constantFrom("\n","\r\n"),className:fc.stringMatching(/^[A-Z][a-z]{1,16}$/)
 }),input=>{
  const file="src/group"+input.directory+"/main.vibe"
  const note=input.refused?"No quick fix: its tag is published API.":"Its quick fix writes the canonical form."
  const output=file+"("+input.line+","+input.column+"): warning "+input.code+": "+input.className+" extends a native class."+input.newline+"  "+note+input.newline
  const ds=parseDiagnostics(output)
  const actual=styleProblems(ds,input.selected?[file]:["unselected.vibe"])
  const expected=input.selected&&!(input.refused&&eligible.includes(input.code))
  assert.equal(actual.length,expected?1:0)
 }),{numRuns:400,seed:4830121})
})
