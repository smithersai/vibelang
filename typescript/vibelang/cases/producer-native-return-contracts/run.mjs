// run-seconds: 150
// Chapter 2: producer annotation compatibility follows the native Stream counterpart.
import assert from "node:assert/strict"
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join,dirname,resolve} from "node:path"
import {fileURLToPath} from "node:url"
import {spawnSync} from "node:child_process"
import {createRequire} from "node:module"
const here=dirname(fileURLToPath(import.meta.url))
const compiler=resolve(here,"../../../built/local/tsc")
const require=createRequire(resolve(here,"../../../../packages/runtime/package.json"))
const stock=require.resolve("typescript/bin/tsc")
const fc=require("fast-check")
const contracts=[["any",true],["unknown",true],["Stream.Stream<number>",true],["Stream.Stream<number>|undefined",true],["Stream.Stream<number>|number",true],["never",false],["Stream.Stream<string>",false],["number",false]]
function check(index,nested,alias,trivia){
 const [annotation,accepted]=contracts[index%contracts.length]
 const dir=mkdtempSync(join(tmpdir(),"producer-contract-"))
 try{
  symlinkSync(join(here,"node_modules"),join(dir,"node_modules"),"dir")
  const header='import * as Stream from "effect/Stream";\n'+(alias?'type Contract='+annotation+';\n':'')+"// native producer contract\n".repeat(trivia)
  const type=alias?"Contract":annotation
  for(const vibe of [false,true]){
   const file=vibe?"main.vibe":"main.ts"
   let body=(vibe?"effect function* values()":"function values()")+": "+type+" { "+(vibe?"yield 1":"return Stream.make(1)")+" }"
   body=nested?"export function factory(){"+body+";return values}":"export "+body
   writeFileSync(join(dir,file),header+body)
   writeFileSync(join(dir,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"ES2022",module:"ESNext",moduleResolution:"Bundler",strict:true,skipLibCheck:true,noEmit:true,types:[]},files:[file]}))
   const result=spawnSync(vibe?compiler:process.execPath,vibe?["-p",dir,"--pretty","false"]:[stock,"-p",dir,"--pretty","false"],{encoding:"utf8",timeout:30000})
   assert.ifError(result.error)
   const context=JSON.stringify({annotation,nested,alias,vibe})+"\n"+result.stdout+result.stderr
   assert.equal(result.status,accepted?0:2,context)
   if(!accepted)assert.match(result.stdout,vibe?/EK2102|TS2322/:/TS2322/,context)
  }
 }finally{rmSync(dir,{recursive:true,force:true})}
}
for(let i=0;i<contracts.length;i++)check(i,false,false,0)
fc.assert(fc.property(fc.integer({min:0,max:contracts.length-1}),fc.boolean(),fc.boolean(),fc.integer({min:0,max:2}),check),{seed:210200,numRuns:12})
console.log("producer contracts match native TypeScript")
