// Chapter 900: real compiler CLI migration and diagnostic contracts.
import assert from "node:assert/strict"
import {test} from "node:test"
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync,cpSync,existsSync,symlinkSync} from "node:fs"
import {join} from "node:path"
import {fileURLToPath,pathToFileURL} from "node:url"
import {spawnSync} from "node:child_process"
const base=fileURLToPath(new URL("../../experiments/",import.meta.url))
const runtime=fileURLToPath(new URL("../../packages/runtime/",import.meta.url))
const compiler=fileURLToPath(new URL("../built/local/tsc",import.meta.url))
function fixture(source,body,severities={EK4833:"off"}){
 const root=mkdtempSync(join(base,"cov900-fix-"))
 try {
  const modules=join(root,"node_modules")
  mkdirSync(modules)
  symlinkSync(join(process.env.EFFECT_NODE_MODULES,"effect"),join(modules,"effect"))
  const published=join(modules,"vibelang-runtime")
  mkdirSync(published)
  const manifest=JSON.parse(readFileSync(join(runtime,"package.json"),"utf8"))
  for(const file of ["package.json",...manifest.files])if(existsSync(join(runtime,file)))cpSync(join(runtime,file),join(published,file),{recursive:true,dereference:true})
  writeFileSync(join(root,"main.vibe"),source)
  writeFileSync(join(root,"package.json"),JSON.stringify({type:"module"}))
  writeFileSync(join(root,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"es2022",module:"nodenext",strict:true,skipLibCheck:true,types:[],lib:["esnext","dom"],outDir:"out"},vibe:{severities},files:["main.vibe"]}))
  const run=(...args)=>{
   const r=spawnSync(compiler,["--pretty","false","-p",join(root,"tsconfig.json"),...args],{encoding:"utf8",timeout:60000})
   assert.notEqual(r.status,null,JSON.stringify({error:r.error?.message,signal:r.signal}))
   return {status:r.status,text:r.stdout+r.stderr}
  }
  const observe=expression=>{
   const script="import * as M from "+JSON.stringify(pathToFileURL(join(root,"out/main.js")).href)+"; "+expression
   const r=spawnSync(process.execPath,["--input-type=module","-e",script],{cwd:root,encoding:"utf8",timeout:60000})
   assert.equal(r.status,0,r.stdout+r.stderr)
   return JSON.parse(r.stdout)
  }
  body({run,observe,source:()=>readFileSync(join(root,"main.vibe"),"utf8"),emit:()=>readFileSync(join(root,"out/main.js"),"utf8")})
 }finally{rmSync(root,{recursive:true,force:true})}
}

// docs/design/src/900-appendices.md#ed55030ff023734c — Chapter 900: EK4833 excludes interfaces extending Effect.
test("EK4833 excludes interfaces extending Effect",()=>{

 fixture('export interface Api<A> extends Effect.Effect<A, never, never> { readonly kind: "Api" }',({run})=>{
  const r=run();assert.equal(r.status,0,r.text);assert.doesNotMatch(r.text,/EK4833:/)
 })
 fixture("export type Api<A> = Effect.Effect<A, never, never>",({run})=>assert.match(run().text,/EK4833:/),{})

})

// docs/design/src/900-appendices.md#f805da7f3c8a6844 — Chapter 900: Option.match advisory names the Option API.
test("Option.match advisory names the Option API",()=>{

 for(const [imp,ns] of [['import { Option } from "effect";',"Option"],['import * as O from "effect/Option";',"O"]]){
  fixture(imp+"\nexport const f=(v:"+ns+".Option<number>):number=>"+ns+".match(v,{onNone:():number=>0,onSome:(n):number=>n});",({run})=>{
   const r=run();assert.equal(r.status,0,r.text)
   assert.match(r.text,/EK4839:/)
   assert.ok(r.text.includes("Option.match chooses with Option's match API;"),r.text)
   assert.doesNotMatch(r.text,/Effect's Match/)
  })
 }

})
