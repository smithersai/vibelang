import assert from "node:assert/strict"
import { mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync } from "node:fs"
import { dirname,join,relative } from "node:path"
import { tmpdir } from "node:os"
import { test } from "node:test"
import { compareApiIdentity,loadTypeScript } from "./api-identity.mjs"
import { SpecPath } from "./testing/spec-path.mjs"
import {createDependencyDocuments} from "./api-identity-diagnostics-cache.mjs"
const ts=loadTypeScript()
class ObservedCache extends Map {
 hits=0
 gets=0
 get(key){this.gets++;const value=super.get(key);if(value!==undefined)this.hits++;return value}
}
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),"identity-dependency-cache-"))
 t.after(()=>rmSync(root,{recursive:true,force:true}))
 const before=join(root,"before"),after=join(root,"after"),modules=join(root,"dependencies/node_modules")
 const put=(file,text)=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text)}
 for(const dir of [before,after])put(join(dir,"package.json"),'{"type":"module"}')
 const dependency=join(modules,"dependency/index.d.ts")
 put(join(modules,"dependency/package.json"),'{"name":"dependency","version":"1.0.0","types":"index.d.ts","type":"module"}')
 put(dependency,"export interface Value { value: string }\n")
 const cache=new ObservedCache(),documents=createDependencyDocuments(ts),options={moduleRoots:[modules]}
 const input='export type {Value} from "dependency";\nexport declare const answer: number;\n'
 const write=(a=input,b=a)=>{put(join(before,"index.d.ts"),a);put(join(after,"index.d.ts"),b)}
 const compare=()=>{
  const fresh=compareApiIdentity(ts,before,after,options)
  const cached=compareApiIdentity(ts,before,after,{...options,dependencyDiagnosticsCache:cache,dependencyDocuments:documents,lazyAmbientDocumentation:true})
  assert.deepEqual(cached,fresh,"reuse must preserve the complete strict comparison result")
  return cached
 }
 write()
 return {root,before,after,dependency,put,cache,documents,options,input,write,compare}
}
test("dependency diagnostics reuse quotes strict published API identity",()=>{
 const quote="the same exported names, each export's type identical to "+String.fromCharCode(96)+"tsc"+String.fromCharCode(96)+"'s in both directions (a type-level check)"
 assert.ok(readFileSync(SpecPath("001-functions.md"),"utf8").includes(quote))
})
test("warm dependencies retain export, type, JSDoc and missing-module negatives",t=>{
 const f=fixture(t)
 assert.equal(f.compare().identical,true)
 const hits=f.cache.hits
 assert.equal(f.compare().identical,true)
 assert.ok(f.cache.hits>hits,"an unchanged dependency environment is actually reused")
 for(const [kind,source] of [
  ["type",f.input.replace("answer: number","answer: string")],
  ["name",f.input.replace("answer:","renamed:")],
  ["doc",f.input.replace("export declare const answer","/** a changed public comment */\nexport declare const answer")],
  ["missing",f.input.replace('"dependency"','"identity-cache-missing-package"')],
 ]){
  f.write(f.input,source)
  const result=f.compare()
  assert.equal(result.identical,false,kind)
  if(kind==="missing"){
   assert.equal(result.comparisonComplete,false)
   assert.ok(result.environmentDiagnostics.some(row=>/TS2307/.test(row.diagnostic)))
  }else{
   assert.equal(result.comparisonComplete,true)
   assert.ok(result[kind==="type"?"typeDifferences":kind==="name"?"nameDifferences":"docDifferences"].length)
  }
 }
})
test("changed dependency contents invalidate a warm successful diagnostic receipt",t=>{
 const f=fixture(t)
 assert.equal(f.compare().identical,true)
 f.put(f.dependency,"export interface Value { value: MissingDependencyType }\n")
 f.compare()
 assert.ok([...f.cache.values()].some(records=>records.some(row=>row.code===2304)),
  "the changed dependency's real TS2304 diagnostic must be checked and retained")
 const hits=f.cache.hits
 f.compare()
 assert.ok(f.cache.hits>hits,"the same diagnostic environment is actually reused")
 assert.ok([...f.cache.values()].some(records=>records.some(row=>row.code===2304)),
  "reuse must preserve the dependency diagnostic, including export-scoped ones")
})
test("changed resolution targets invalidate otherwise unchanged dependency text",t=>{
 const f=fixture(t)
 const edge=join(f.root,"dependencies/node_modules/edge")
 f.put(join(edge,"package.json"),'{"name":"edge","version":"1.0.0","types":"a.d.ts","type":"module"}')
 f.put(join(edge,"a.d.ts"),"export interface Value { value: string }\n")
 f.put(join(edge,"b.d.ts"),"export interface Value { value: MissingResolutionType }\n")
 f.put(f.dependency,'export type {Value} from "edge";\n')
 assert.equal(f.compare().identical,true)
 f.put(join(edge,"package.json"),'{"name":"edge","version":"1.0.0","types":"b.d.ts","type":"module"}')
 f.compare()
 assert.ok([...f.cache.values()].some(records=>records.some(row=>row.code===2304)),
  "the changed resolution target must contribute its actual diagnostic")
})
test("owned scripts, global augmentations and namespace exports bypass reuse",t=>{
 const f=fixture(t)
 assert.equal(f.compare().identical,true)
 for(const source of [
  "interface CacheOwnedGlobal { value: string }\n",
  f.input+"\ndeclare global { interface CacheOwnedGlobal { value: string } }\n",
  f.input+"\nexport as namespace CacheOwnedGlobal;\n",
  f.input+'\ndeclare module "dependency" { interface Value { additional: number } }\n',
 ]){
  f.write(source)
  const gets=f.cache.gets
  f.compare()
  assert.equal(f.cache.gets,gets,"an owned ambient contribution must not reuse dependency diagnostics")
 }
})
test("external imports back into an owned snapshot bypass reuse",t=>{
 const f=fixture(t)
 const target=relative(dirname(f.dependency),join(f.before,"index.js")).replaceAll("\\","/")
 f.put(f.dependency,'export type Value = import('+JSON.stringify(target)+').Owned;\n')
 f.write("export interface Owned { value: string }\n"+f.input)
 const gets=f.cache.gets
 f.compare()
 assert.equal(f.cache.gets,gets)
})
test("diagnostic receipts remain bounded across changing dependency environments",t=>{
 const f=fixture(t)
 for(let n=0;n<18;n++){
  f.put(f.dependency,"export interface Value { value: string; field"+n+"?: number }\n")
  assert.equal(f.compare().identical,true)
  assert.ok(f.cache.size<=16,"the worker must not retain unbounded diagnostic environments")
 }
})

test("the document registry actually reuses parsed library declarations",t=>{
 const f=fixture(t)
 assert.equal(f.compare().identical,true)
 const before=f.documents.stats()
 assert.ok(before.reads>0)
 assert.equal(f.compare().identical,true)
 const after=f.documents.stats()
 assert.ok(after.hits>before.hits)
 assert.ok(after.documents<=1024)
 assert.ok(after.textBytes<=32*1024*1024)
})
test("owned module augmentations do not pollute a later library type",t=>{
 const f=fixture(t)
 const augmented=f.input+'\ndeclare module "dependency" { interface Value { additional: number } }\n'
 f.write(augmented)
 f.compare()
 f.write('import type {Value} from "dependency";\nexport declare const value: Value;\n',
  'export declare const value: { value: string };\n')
 const clean=f.compare()
 assert.equal(clean.comparisonComplete,true,JSON.stringify(clean))
 assert.equal(clean.identical,true,JSON.stringify(clean))
})
test("changed dependency documentation survives registry reuse",t=>{
 const f=fixture(t)
 const dirs=[f.before,f.after]
 for(const dir of dirs){
  f.put(join(dir,"node_modules/dependency/package.json"),'{"name":"dependency","version":"1.0.0","types":"index.d.ts","type":"module"}')
  f.put(join(dir,"node_modules/dependency/index.d.ts"),"/** original public documentation */\nexport interface Value { value: string }\n")
 }
 assert.equal(f.compare().identical,true)
 const resets=f.documents.stats().resets
 f.put(join(f.after,"node_modules/dependency/index.d.ts"),"/** changed public documentation */\nexport interface Value { value: string }\n")
 const result=f.compare()
 assert.equal(result.identical,false,JSON.stringify(result))
 assert.ok(result.docDifferences.length>0,JSON.stringify(result))
 assert.ok(f.documents.stats().resets>resets)
})
test("package module format changes preserve the fresh TypeScript verdict",t=>{
 const f=fixture(t)
 f.put(f.dependency,"declare namespace Value { interface Shape { value: string } }\nexport = Value;\n")
 f.write('import Value = require("dependency");\nexport type Result = Value.Shape;\n')
 f.compare()
 f.put(join(dirname(f.dependency),"package.json"),'{"name":"dependency","version":"1.0.0","types":"index.d.ts","type":"commonjs"}')
 f.compare()
 f.put(join(dirname(f.dependency),"package.json"),'{"name":"dependency","version":"1.0.0","types":"index.d.ts","type":"module"}')
 f.compare()
})

test("reused diagnostic programs retain errors across file-group boundaries",t=>{
 const f=fixture(t)
 const exports=[]
 for(let n=0;n<20;n++){
  exports.push('export type {P'+n+'} from "./part'+n+'.js";')
  for(const dir of [f.before,f.after])f.put(join(dir,"part"+n+".d.ts"),"export type P"+n+"=MissingCache"+n+";\n")
 }
 f.write(exports.join("\n")+"\n")
 const result=f.compare()
 for(let n=0;n<20;n++)assert.ok(result.environmentDiagnostics.some(row=>row.diagnostic.includes("MissingCache"+n)),JSON.stringify(result))
})
test("shared ambient paths avoid unused documentation queries without changing the proof",t=>{
 const f=fixture(t)
 f.put(f.dependency,"export interface Value { value:string }\ndeclare global { interface SymbolConstructor { readonly identityCacheProbe: unique symbol } }\n")
 const reference=compareApiIdentity(ts,f.before,f.after,f.options)
 assert.equal(reference.identical,true,JSON.stringify(reference))
 function measure(lazy){
  let symbols=0
  const measured={...ts,createProgram(...args){
   const program=ts.createProgram(...args)
   return new Proxy(program,{get(target,key){
    if(key==="getTypeChecker")return()=>{
     const checker=target.getTypeChecker()
     return new Proxy(checker,{get(owner,name){
      const value=Reflect.get(owner,name)
      if(name==="getSymbolAtLocation")return(...values)=>{symbols++;return value.apply(owner,values)}
      return typeof value==="function"?value.bind(owner):value
     }})
    }
    const value=Reflect.get(target,key)
    return typeof value==="function"?value.bind(target):value
   }})
  }}
  const result=compareApiIdentity(measured,f.before,f.after,{...f.options,
   dependencyDiagnosticsCache:new Map(),dependencyDocuments:createDependencyDocuments(measured),
   lazyAmbientDocumentation:lazy})
  assert.deepEqual(result,reference)
  return symbols
 }
 const eager=measure(false),lazy=measure(true)
 assert.ok(lazy<eager,"unused ambient documentation queries were not removed: "+JSON.stringify({eager,lazy}))
})
