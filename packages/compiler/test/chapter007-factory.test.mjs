import {chapter007EffectTwinModules} from "../../../typescript/vibelang/test/chapter007-twin.mjs"
import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync,symlinkSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
import {test} from "node:test"
const repo=fileURLToPath(new URL("../../../",import.meta.url))
const binary=process.env.VIBELANG_BINARY||join(repo,"packages/compiler/native/vibelang")
// Chapter 007 / written legacy Effect types do not promote plain held-program factories: docs/design/src/007-tooling.md#4a8622b915fe7443
test("Chapter 007 / a plain factory keeps call-time work after VIP migration",t=>{
 const root=mkdtempSync(join(tmpdir(),"chapter007-factory-"));t.after(()=>rmSync(root,{recursive:true,force:true}))
 const prefix='import {Effect} from "effect";let calls=0;\n'
 const suffix='\ntype Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;type Expect<T extends true>=T;type SuccessProof=Expect<Equal<Effect.Success<ReturnType<typeof factory>>,number>>;type ErrorProof=Expect<Equal<Effect.Error<ReturnType<typeof factory>>,never>>;type ServicesProof=Expect<Equal<Effect.Services<ReturnType<typeof factory>>,never>>;\nconst held=factory(7);const callsAtCall=calls;export const result={callsAtCall,exit:Effect.runSyncExit(held)};\n'
 const observed=[]
 for(const native of [true,false]){
  const dir=join(root,native?"native":"vibe");mkdirSync(join(dir,"node_modules"),{recursive:true})
  const modules=native?chapter007EffectTwinModules(root):(process.env.EFFECT_NODE_MODULES||join(repo,"experiments/node_modules"))
  assert.ok(modules,"exact Effect TypeScript twin installation is required")
  if(native)assert.equal(JSON.parse(readFileSync(join(modules,"effect/package.json"),"utf8")).version,"4.1.0")
  symlinkSync(join(modules,"effect"),join(dir,"node_modules/effect"));symlinkSync(join(repo,"packages/runtime"),join(dir,"node_modules/vibelang-runtime"));writeFileSync(join(dir,"package.json"),'{"type":"module"}')
  const file="main."+(native?"ts":"vibe"),source=prefix+'export const factory=(n:number):'+(native?"Effect.Effect<number>":"number!!")+' => {calls++;return Effect.succeed(n)}'+suffix
  writeFileSync(join(dir,file),source)
  const compile=fix=>{
   const outDir=fix?"after":"before"
   writeFileSync(join(dir,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",strict:true,types:[],outDir},files:[file],vibe:{effectGlobals:false,effectModules:false}}))
   const r=spawnSync(native?process.execPath:binary,native?[join(repo,"docs/tools/node_modules/typescript/bin/tsc"),"-p",".","--pretty","false"]:["-p",".","--pretty","false",...(fix?["--fix","--fix-vip-only"]:[])],{cwd:dir,encoding:"utf8",timeout:120000})
   assert.equal(r.status,0,r.stdout+r.stderr)
   const run=spawnSync(process.execPath,["--input-type=module","-e",'import {result} from "./'+outDir+'/main.js";console.log(JSON.stringify(result))'],{cwd:dir,encoding:"utf8",timeout:30000})
   assert.equal(run.status,0,run.stdout+run.stderr);return JSON.parse(run.stdout)
  }
  observed.push(compile(false))
  if(!native)observed.push(compile(true))
 }
 for(const actual of observed){assert.equal(actual.callsAtCall,1);assert.equal(actual.exit._tag,"Success");assert.equal(actual.exit.value,7)}
 assert.deepEqual(observed[0],observed[1]);assert.deepEqual(observed[1],observed[2])
})
