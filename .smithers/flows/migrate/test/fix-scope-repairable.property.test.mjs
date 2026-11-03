import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { fixProgramFiles } from "../lib/fix-scope.mjs"
import { fixToFixedPoint } from "../lib/codemod.mjs"
import { parseDiagnostics } from "../lib/diagnostics.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-ek0301-fix-scope.json", import.meta.url)))
const repo=fileURLToPath(new URL("../../../../",import.meta.url))
function fixture() {
 const root=mkdtempSync(join(tmpdir(),"alchemy-scope-repair-"))
 const put=(file,text)=>{mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),text)}
 put("package.json",'{"type":"module"}')
 for(const [file,text] of Object.entries(corpus.files))put(file,text)
 put("tsconfig.json",JSON.stringify(corpus.config))
 return {root,put,dispose:()=>rmSync(root,{recursive:true,force:true})}
}
function fake(f,{code=1,extra="",newline="\n",stream="stdout",prefix=false,empty=false,crash=false}={}){
 const files=empty?[]:[join(f.root,"src/a.vibe"),join(f.root,"src/b.vibe")]
 const diagnostic='src/a.vibe(1,44): error EK0301: Parenthesize a union in an Effect slot.'
 const paths=["bundled:///libs/lib.es2022.full.d.ts",...files,...files.slice(0,1)].join(newline)+newline
 const text=diagnostic+newline+"  Use (A | undefined)!E!R."+newline+(extra?extra+newline:"")+(crash?"panic: stopped"+newline:"")
 const stdout=stream==="stdout"?(prefix?text+paths:paths+text):paths
 const stderr=stream==="stderr"?text:""
 f.put("compiler.mjs",'#!/usr/bin/env node\nprocess.stdout.write('+JSON.stringify(stdout)+');process.stderr.write('+JSON.stringify(stderr)+');process.exit('+code+');\n')
 chmodSync(join(f.root,"compiler.mjs"),0o755)
 return join(f.root,"compiler.mjs")
}
test("EK0301 does not prevent discovery of every Vibe file before its fixing pass",async()=>{
 const f=fixture()
 try{
  const log=join(f.root,"scope")
  const files=await fixProgramFiles({compiler:fake(f),tsconfig:"tsconfig.json",cwd:f.root,log})
  assert.deepEqual(files,[join(f.root,"src/a.vibe"),join(f.root,"src/b.vibe")])
  const receipt=readFileSync(log+".scope.log","utf8")
  assert.match(receipt,/"stage":"discovered"/)
  assert.match(receipt,/"recoverableDiagnostics":\["EK0301"\]/)
  assert.match(receipt,/"semanticChecksDeferred":true/)
  assert.equal(readFileSync(join(f.root,"src/a.vibe"),"utf8"),corpus.files["src/a.vibe"])
 }finally{f.dispose()}
})
test("configuration, ordinary syntax errors, crashes and empty scope still refuse discovery",async()=>{
 for(const config of [
  {extra:"error TS5083: Cannot read configuration."},
  {extra:"src/b.vibe(1,10): error TS1005: Expected token."},
  {extra:"src/b.vibe(1,10): error TS2322: Bad assignment."},
  {extra:"Error: internal wrapper failure"},
  {code:2},
  {empty:true},
  {crash:true}
 ]){
  const f=fixture()
  try{
   await assert.rejects(fixProgramFiles({compiler:fake(f,config),tsconfig:"tsconfig.json",cwd:f.root}),/fix scope|did not finish/)
   assert.equal(readFileSync(join(f.root,"src/a.vibe"),"utf8"),corpus.files["src/a.vibe"])
  }finally{f.dispose()}
 }
})
test("property: line endings, streams, diagnostic positions and duplicate paths preserve the complete scope",async()=>{
 await fc.assert(fc.asyncProperty(fc.constantFrom("\n","\r\n"),fc.constantFrom("stdout","stderr"),fc.boolean(),fc.boolean(),async(newline,stream,prefix,bad)=>{
  const f=fixture()
  try{
   const options={newline,stream,prefix,extra:bad?"error TS5083: Cannot read configuration.":""}
   const operation=fixProgramFiles({compiler:fake(f,options),tsconfig:"tsconfig.json",cwd:f.root})
   if(bad)await assert.rejects(operation,/fix scope/)
   else assert.deepEqual(await operation,[join(f.root,"src/a.vibe"),join(f.root,"src/b.vibe")])
  }finally{f.dispose()}
 }),{seed:561172,numRuns:100})
})
test("real rc3: scope discovery reaches EK0301 repair and the hidden type error is then reported",async()=>{
 const compiler=process.env.ALCHEMY_RC3_BINARY ?? process.env.VIBELANG_BINARY ?? join(repo,"packages/compiler/native/vibelang")
 assert.ok(compiler&&existsSync(compiler),"build the native compiler for this regression")
 const f=fixture()
 try{
  mkdirSync(join(f.root,"node_modules"))
  const runtime=join(repo,"packages/runtime")
  symlinkSync(dirname(createRequire(join(runtime,"package.json")).resolve("effect/package.json")),join(f.root,"node_modules/effect"),"dir")
  symlinkSync(runtime,join(f.root,"node_modules/vibelang-runtime"),"dir")
  const native=args=>spawnSync(compiler,["-p","tsconfig.json","--pretty","false",...args],{cwd:f.root,env:{...process.env,VIBELANG_RUNTIME:runtime},encoding:"utf8",timeout:60000})
  const before=native([])
  const beforeCodes=parseDiagnostics(before.stdout+"\n"+before.stderr).map(d=>d.code)
  assert.ok(beforeCodes.includes("EK0301"),before.stdout+before.stderr)
  assert.ok(!beforeCodes.includes("TS2322"),"parser error should demonstrate the original suppressed semantic check")
  const log=join(f.root,"receipts/fix")
  const files=await fixProgramFiles({compiler,tsconfig:"tsconfig.json",cwd:f.root,log,timeoutMs:60000})
  assert.ok(files.includes(join(f.root,"src/a.vibe")))
  assert.ok(files.includes(join(f.root,"src/b.vibe")))
  const result=await fixToFixedPoint({compiler,tsconfig:"tsconfig.json",cwd:f.root,root:f.root,log,only:["src/a.vibe"],timeoutMs:60000})
  assert.equal(result.settled,true)
  assert.match(readFileSync(join(f.root,"src/a.vibe"),"utf8"),/get:\s*\(A\s*\|\s*undefined\)!E!R/)
  assert.equal(readFileSync(join(f.root,"src/b.vibe"),"utf8"),corpus.files["src/b.vibe"])
  const checked=native([])
  const codes=parseDiagnostics(checked.stdout+"\n"+checked.stderr).map(d=>d.code)
  assert.ok(codes.includes("TS2322"),checked.stdout+checked.stderr)
  assert.ok(!codes.includes("EK0301"),checked.stdout+checked.stderr)
 }finally{f.dispose()}
})
