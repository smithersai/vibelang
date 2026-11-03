import assert from "node:assert/strict"
import fs from "node:fs"
import {pathToFileURL} from "node:url"
import path from "node:path"
import {project,check,nativeCheck,codes} from "./coverage-tooling.mjs"

export async function checkDeclarationPrelude(caseURL, named, Effect) {
 const dir=path.dirname(new URL(caseURL).pathname)
 const source=fs.readFileSync(path.join(dir,"program.vibe"),"utf8")
 const native=fs.readFileSync(path.join(dir,"native.ts"),"utf8")
 const matrix=named?[[true,true]]:[[false,false],[false,true],[true,false],[true,true]]
 for(const [effectModules,effectGlobals] of matrix){
  const name="prelude-"+Number(effectModules)+"-"+Number(effectGlobals)
  const p=project(caseURL,name,{"program.vibe":source,"native.ts":native},{files:["program.vibe"],vibe:{effectModules,effectGlobals},compilerOptions:{declaration:true,noEmit:false,allowArbitraryExtensions:true}})
  const actual=check(p)
  assert.equal(actual.status,0,actual.output)
  const declaration=p.read("build/program.d.ts")
  if(named){
   assert.match(declaration,/import\s*\{\s*Effect\s*\}\s*from\s*["']effect["']/)
   for(const signature of [/type Task\s*=\s*Effect\.Effect/,/value\(\):\s*Effect\.Effect/,/execute\(input: Task\):\s*Effect\.Effect/,/global:\s*Effect\.Effect/])assert.match(declaration,signature)
  }
  // Stock tsc consumes the emitted sidecar with no VibeLang configuration.
  const options={strict:true,target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",types:[],skipLibCheck:true,declaration:true,outDir:"build",allowArbitraryExtensions:true}
  p.write("native.json",JSON.stringify({compilerOptions:options,files:["native.ts"]}))
  let reference=nativeCheck(p,"native.json")
  assert.equal(reference.status,0,reference.output)
  p.write("contracts.ts",'import type * as A from "./program.vibe";import type * as N from "./native.js";type Eq<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;type Assert<T extends true>=T;type API=Assert<Eq<typeof A,typeof N>>;type Alias=Assert<Eq<A.Task,N.Task>>;')
  p.write("contracts.json",JSON.stringify({compilerOptions:{...options,noEmit:true},files:["native.ts","contracts.ts"]}))
  reference=nativeCheck(p,"contracts.json")
  assert.equal(reference.status,0,reference.output)
  const actualModule=await import(pathToFileURL(path.join(p.dir,"build/program.js")).href)
  const nativeModule=await import(pathToFileURL(path.join(p.dir,"build/native.js")).href)
  const observed=await Effect.runPromiseExit(actualModule.main())
  const expected=await Effect.runPromiseExit(nativeModule.main())
  assert.equal(expected._tag,"Success")
  assert.deepEqual(expected.value,[1,1,1])
  assert.deepEqual(observed,expected)
  assert.deepEqual(await Effect.runPromiseExit(actualModule.global),await Effect.runPromiseExit(nativeModule.global))
  if(!named){
   // These controls prevent a misspelled/ignored option from passing the matrix.
   for(const [kind,enabled,expression] of [["module",effectModules,"Schema.String"],["global",effectGlobals,'sleep("1 millis")']]){
    const c=project(caseURL,name+"-"+kind,{"input.vibe":"export const value="+expression+"\n"},{vibe:{effectModules,effectGlobals}})
    const result=check(c)
    if(enabled)assert.equal(result.status,0,result.output)
    else{assert.notEqual(result.status,0,result.output);assert.ok(codes(result.output).includes("TS2304"),result.output)}
   }
  }
 }
}
