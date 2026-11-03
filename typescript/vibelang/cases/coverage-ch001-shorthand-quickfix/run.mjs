// Spec rule: docs/design/src/001-functions.md#d1bea2e4190cc89a
// Chapter 001: top-level shorthand diagnostics insert function and preserve native API and Exit.
// Spec rule: docs/design/src/001-functions.md#add3e51087eb1cdb
// run-seconds: 1200
// Four cells, each with five independently bounded 60-second compiler stages.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import {pathToFileURL} from "node:url"
import {Effect} from "effect"
import {project,check,nativeCheck,codes} from "../../tests/coverage-tooling.mjs"
const observedDiagnostics=[]
for(const kind of ["effect","async"]) for(const generic of [false,true]) {
 const key=kind+"-"+Number(generic)
 const head=generic?"load<T>(value: T)":"load()"
 const result=generic?"value":"1"
 const prefix=generic?"export ":""
 const exports=generic?"":"\nexport {load}"
 const source=prefix+kind+" "+head+" {return "+result+"}"+exports+"\n"
 const native=kind==="effect"?'import {Effect} from "effect"\n'+prefix+"function "+head+" {return Effect.gen(function*(){return "+result+"})}"+exports+"\n":prefix+"async function "+head+" {return "+result+"}"+exports+"\n"
 const p=project(import.meta.url,"shorthand-"+key,{"program.vibe":source,"native.ts":native},{files:["program.vibe"],compilerOptions:{noEmit:false,declaration:true,allowArbitraryExtensions:true}})
 const before=check(p)
 observedDiagnostics.push({key,codes:codes(before.output)})
 assert.notEqual(before.status,0,key+": shorthand unexpectedly compiled")
 check(p,["--fix"])
 const edited=p.read("program.vibe")
 assert.ok(edited.includes(kind+" function "+head),key+": "+edited)
 const after=check(p)
 assert.equal(after.status,0,key+": "+after.output)
 const options={strict:true,target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",types:[],skipLibCheck:true,outDir:"build",allowArbitraryExtensions:true}
 p.write("native.json",JSON.stringify({compilerOptions:options,files:["native.ts"]}))
 const reference=nativeCheck(p,"native.json")
 assert.equal(reference.status,0,key+": "+reference.output)
 p.write("contracts.ts",'import type * as A from "./program.vibe";import type * as N from "./native.js";type Eq<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;type Assert<T extends true>=T;type API=Assert<Eq<typeof A.load,typeof N.load>>;')
 p.write("contracts.json",JSON.stringify({compilerOptions:{...options,noEmit:true},files:["native.ts","contracts.ts"]}))
 const contract=nativeCheck(p,"contracts.json")
 assert.equal(contract.status,0,key+": "+contract.output)
 const actual=await import(pathToFileURL(path.join(p.dir,"build/program.js")).href)
 const expected=await import(pathToFileURL(path.join(p.dir,"build/native.js")).href)
 const args=generic?[7]:[]
 const observe=fn=>Effect.runPromiseExit(kind==="effect"?fn(...args):Effect.promise(()=>fn(...args)))
 const wanted=await observe(expected.load)
 assert.equal(wanted._tag,"Success")
 assert.equal(wanted.value,generic?7:1)
 assert.deepEqual(await observe(actual.load),wanted)
}
assert.deepEqual(observedDiagnostics.map(x=>x.codes),Array.from({length:4},()=>["EK0101"]),"all four repairs and native API/Exit comparisons passed; shorthand diagnostics must be EK0101: "+JSON.stringify(observedDiagnostics))
console.log("coverage-ok")
