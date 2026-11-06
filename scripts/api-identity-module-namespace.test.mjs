import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"
const repo=fileURLToPath(new URL("../",import.meta.url)),ts=loadTypeScript()
const fc=createRequire(new URL("../docs/tools/package.json",import.meta.url))("fast-check")
const corpus=JSON.parse(readFileSync(new URL("./api-identity-corpus/smithers-native-body-namespace.json",import.meta.url)))
const compilerOptions={lib:["lib.es2022.d.ts"]}
function fixture(files, check, commonjs=false) {
 const root=mkdtempSync(join(tmpdir(),"api-module-namespace-"))
 try {
  for(const side of ["before","after"]) {
   const dir=join(root,side);mkdirSync(dir)
   for(const [file,text] of Object.entries(files[side])) {
    mkdirSync(dirname(join(dir,file)),{recursive:true});writeFileSync(join(dir,file),text)
   }
   writeFileSync(join(dir,"package.json"),JSON.stringify({name:"namespace-fixture",type:commonjs?"commonjs":"module",exports:{".":"./index.d.ts"}}))
   symlinkSync(join(repo,"packages/runtime/node_modules"),join(dir,"node_modules"),"dir")
  }
  return check(join(root,"before"),join(root,"after"))
 } finally {rmSync(root,{recursive:true,force:true})}
}
function verify({namespace="API",nested=false,changed}={}) {
 const files=structuredClone(corpus.files)
 for(const side of ["before","after"]) {
  files[side]["index.d.ts"]='export * as '+namespace+' from "./leaf.js";\n'
  if(nested) {
   files[side]["outer.d.ts"]=files[side]["index.d.ts"]
   files[side]["index.d.ts"]='export * as Outer from "./outer.js";\n'
  }
 }
 if(changed==="type")files.after["leaf.d.ts"]=files.after["leaf.d.ts"].replace("(text: string) => boolean","(text: number) => boolean")
 if(changed==="value")files.after["native.d.ts"]=files.after["native.d.ts"].replace('"smthrs-secret-"','"changed-"')
 if(changed==="doc")files.after["native.d.ts"]=files.after["native.d.ts"].replace("/** Stable binding. */","/** Changed binding. */")
 if(changed==="added")files.after["leaf.d.ts"]+='\nexport declare const extra: boolean;\n'
 if(changed==="missing")files.after["leaf.d.ts"]=files.after["leaf.d.ts"].replace(", prefix }"," }")
 fixture(files,(before,after)=>{
  const r=compareApiIdentity(ts,before,after,{compilerOptions})
  assert.equal(r.comparisonComplete,true,JSON.stringify(r))
  assert.equal(r.identical,!changed,JSON.stringify(r))
  if(changed)assert.ok(r[changed==="doc"?"docDifferences":["added","missing"].includes(changed)?"nameDifferences":"typeDifferences"].length,JSON.stringify(r))
 })
}
test("a native-body re-export retains its module namespace API",()=>verify())
test("nested module namespaces retain their forwarded member API",()=>verify({nested:true}))
for(const changed of ["type","value","doc","added","missing"])test("namespace "+changed+" changes remain visible",()=>verify({changed}))
test("ordinary objects, declared mutable namespaces and CommonJS functions remain strict",()=>{
 for(const [a,b,commonjs] of [
  ['export declare const value:{readonly member:string};','export declare const value:{member:string};',false],
  ['export declare namespace Value {let member:string;}','export declare namespace Value {const member:string;}',false],
  ['declare function make(value:string):number;declare namespace make{const version:1;}export=make;','declare function make(value:number):number;declare namespace make{const version:1;}export=make;',true]
 ])fixture({before:{"index.d.ts":a},after:{"index.d.ts":b}},(before,after)=>{
  const r=compareApiIdentity(ts,before,after,{compilerOptions})
  assert.equal(r.comparisonComplete,true,JSON.stringify(r));assert.equal(r.identical,false,JSON.stringify(r));assert.ok(r.typeDifferences.length,JSON.stringify(r))
  assert.ok(r.typeDifferences.every(x=>!x.probe?.includes("__api_key")),JSON.stringify(r))
 },commonjs)
})
test("stock TypeScript keeps imported module bindings readonly",()=>{
 for(const side of ["before","after"])fixture(corpus.files,(before,after)=>{
  const dir=side==="before"?before:after,file=join(dir,"readonly.ts")
  writeFileSync(file,'import * as Namespace from "./leaf.js";Namespace.prefix=Namespace.prefix;\n')
  const p=ts.createProgram([file],{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,strict:true,skipLibCheck:true,noEmit:true,types:[],lib:["lib.es2022.d.ts"]})
  const diagnostics=ts.getPreEmitDiagnostics(p).filter(d=>d.file?.fileName===file)
  assert.deepEqual(diagnostics.map(d=>d.code),[2540],ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>dir,getNewLine:()=>"\n",getCanonicalFileName:x=>x}))
 })
})
test("property: namespace forwarding preserves identity and exposes changes",async()=>{
 await checkProperty(fc,{name:"api-module-namespace-readonly",rule:corpus.rule,command:"node --test scripts/api-identity-module-namespace.test.mjs",
  arbitrary:fc.record({namespace:fc.constantFrom("API","Runtime","Library"),nested:fc.boolean(),changed:fc.option(fc.constantFrom("type","value","doc","added","missing"),{nil:undefined})}),
  numRuns:12,check:verify})
})
