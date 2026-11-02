import assert from "node:assert/strict"
import { fakeProjectFiles } from "./helpers/fake-project-files.mjs"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fixToFixedPoint } from "../lib/codemod.mjs"
const fc=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))("fast-check")
const corpus=JSON.parse(readFileSync(new URL("./corpus/foldkit-interrupted-foreign.json",import.meta.url)))
const put=(root,file,bytes)=>{mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),bytes)}
async function exercise({mode=3,scope="selected",payload=Buffer.from(corpus.foreignBefore),remove=false,count=1}={}) {
 const root=mkdtempSync(join(tmpdir(),"foldkit-interrupted-foreign-"))
 try{
  put(root,corpus.selected,corpus.selectedBefore)
  const foreign=Array.from({length:count},(_,i)=>i===0?corpus.foreign:"packages/earlier"+i+"/hand-repaired.vibe")
  for(const file of foreign)put(root,file,payload)
  const script=join(root,"compiler.mjs")
  const changed=Buffer.from(corpus.foreignAfter)
  const code=[
   'import fs from "node:fs";import path from "node:path";',
   'const root='+JSON.stringify(root)+';',
   'fs.writeFileSync(path.join(root,'+JSON.stringify(corpus.selected)+'),'+JSON.stringify(corpus.selectedAfter)+');',
   ...foreign.map(file=>remove?'fs.unlinkSync(path.join(root,'+JSON.stringify(file)+'));':'fs.writeFileSync(path.join(root,'+JSON.stringify(file)+'),Buffer.from('+JSON.stringify(changed.toString("base64"))+',"base64"));'),
   mode===0?'console.log("vibelang --fix: 0 fixes in 0 files.");':typeof mode==="number"?'console.error("vibelang --fix: interrupted; kept the fixes it verified.");process.exit('+mode+');':'process.kill(process.pid,'+JSON.stringify(mode)+');'
  ].join("\n")
  writeFileSync(script,"#!/usr/bin/env node\n"+fakeProjectFiles(root)+code+"\n");chmodSync(script,0o755)
  const only=scope==="all"?undefined:scope==="none"?[]:[corpus.selected]
  let result,error
  try{result=await fixToFixedPoint({compiler:script,tsconfig:"tsconfig.json",cwd:root,root,only})}catch(e){error=e}
  if(mode===0)assert.equal(error,undefined)
  else assert.match(error?.message??"",/compiler did not finish|interrupt|signal|finish/i)
  const keepForeign=scope==="all"
  for(const file of foreign){
   if(keepForeign&&remove)assert.equal(existsSync(join(root,file)),false)
   else assert.deepEqual(readFileSync(join(root,file)),keepForeign?changed:payload,"unselected bytes restored: "+file)
  }
  assert.equal(readFileSync(join(root,corpus.selected),"utf8"),scope==="none"?corpus.selectedBefore:corpus.selectedAfter,"selected verified writes survive interruption")
  return result
 }finally{rmSync(root,{recursive:true,force:true})}
}
test("foldkit-112: interrupted compiler without a per-file summary restores the earlier module",async()=>{
 await exercise()
})
// README contract: every nonselected source returns to its original bytes,
// including on failed or signalled compiler runs; selected verified changes stay.
test("foldkit-112: every exit preserves scope across packages, deleted files and arbitrary bytes",async()=>{
 await fc.assert(fc.asyncProperty(
  fc.constantFrom(0,3,"SIGTERM","SIGKILL"),fc.constantFrom("selected","none","all"),
  fc.uint8Array({minLength:0,maxLength:32}),fc.boolean(),fc.integer({min:1,max:5}),
  async(mode,scope,bytes,remove,count)=>{
   const payload=Buffer.concat([Buffer.from("// checked hand repair\r\n"),Buffer.from(bytes)])
   await exercise({mode,scope,payload,remove,count})
  }),{numRuns:40,seed:112501})
})
