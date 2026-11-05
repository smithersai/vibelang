// Smithers flow/Deferred publishes await as an alias. A declaration probe
// must use a legal local alias and still detect actual changes to that export.
import assert from "node:assert/strict"
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {createRequire} from "node:module"
import {test} from "node:test"
import {compareApiIdentity,loadTypeScript} from "./api-identity.mjs"
import {createEs5FixtureGuard} from "./testing/fixture-libraries.mjs"
const {ts,assertLibraries}=createEs5FixtureGuard(loadTypeScript(),"Reserved-export fixtures")
const compilerOptions={lib:["lib.es5.d.ts"]}
const nativeOptions={...compilerOptions,strict:true,noEmit:true,types:[],module:ts.ModuleKind.Preserve,moduleResolution:ts.ModuleResolutionKind.Bundler}
const fc=createRequire(new URL("../docs/tools/package.json",import.meta.url))("fast-check")
const corpus=JSON.parse(readFileSync(new URL("./api-identity-corpus/smithers-flow-await.json",import.meta.url),"utf8"))
function check({keyword,depth,changed=false}){
 const dir=mkdtempSync(join(tmpdir(),"api-keyword-"))
 try{
  for(const side of ["before","after"]){
   const root=join(dir,side);mkdirSync(root)
   const local=side==="before"?"originalAwait":"renamedAwait"
   const result=changed&&side==="after"?"string":"number"
   const leaf="declare function "+local+"<A>(value:A):"+result+";\nexport { "+local+" as "+JSON.stringify(keyword)+" };\n"
   writeFileSync(join(root,"leaf.d.ts"),leaf)
   let last="leaf"
   for(let i=0;i<depth;i++){
    const name="level"+i
    writeFileSync(join(root,name+".d.ts"),'export * as Box from "./'+last+'.js";\n')
    last=name
   }
   writeFileSync(join(root,"index.d.ts"),depth?'export * from "./'+last+'.js";\n':leaf)
   writeFileSync(join(root,"package.json"),JSON.stringify({name:"@demo/flow",type:"module",types:"./index.d.ts"}))
   const program=ts.createProgram([join(root,"index.d.ts")],nativeOptions)
   assertLibraries()
   assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>d.code),[],"stock TypeScript accepts each declaration tree")
  }
  const consumer=join(dir,"consumer.ts"),path='["Box"]'.repeat(depth)+'['+JSON.stringify(keyword)+']'
  writeFileSync(consumer,'type Before=(typeof import("./before/index.js"))'+path+';\n'+
   'type After=(typeof import("./after/index.js"))'+path+';\n'+
   'declare const before:Before; declare const after:After; const forward:After=before; const reverse:Before=after;\n')
  const program=ts.createProgram([consumer],nativeOptions)
  assertLibraries()
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>d.code),changed?[2322,2322]:[],"native assignments retain alias identity and changed return types")
  const r=compareApiIdentity(ts,join(dir,"before"),join(dir,"after"),{compilerOptions})
  assertLibraries()
  assert.equal(r.comparisonComplete,true,JSON.stringify(r))
  assert.equal(r.identical,!changed,JSON.stringify(r))
  if(changed)assert(r.typeDifferences.length,JSON.stringify(r))
 }finally{rmSync(dir,{recursive:true,force:true})}
}
test("Smithers await export: top-level alias and namespace re-export compare completely",()=>{
 check(corpus)
 check({...corpus,depth:1})
 check({...corpus,depth:2})
})
test("reserved export aliases still reject changed return types",()=>{
 check({...corpus,changed:true})
 check({...corpus,depth:1,changed:true})
})
test("keyword exports preserve alias identity through namespace depth and retain negative controls",()=>{
 fc.assert(fc.property(fc.record({keyword:fc.constantFrom("await","yield","default","class","function","new"),depth:fc.integer({min:0,max:2}),changed:fc.boolean()}),check),{seed:20261104,numRuns:24})
})

test("reserved-export fixture libraries retain native missing BigInt errors",()=>{
 const dir=mkdtempSync(join(tmpdir(),"api-keyword-missing-lib-"))
 try{
  for(const side of ["before","after"]){
   const root=join(dir,side);mkdirSync(root)
   const file=join(root,"index.d.ts")
   writeFileSync(file,'declare function local():BigInt; export {local as "await"};')
   const program=ts.createProgram([file],nativeOptions)
   assertLibraries()
   assert.ok(ts.getPreEmitDiagnostics(program).some(d=>d.code===2583))
  }
  const r=compareApiIdentity(ts,join(dir,"before"),join(dir,"after"),{compilerOptions})
  assertLibraries()
  assert.equal(r.comparisonComplete,false)
  assert.equal(r.identical,false)
  assert.ok(r.environmentDiagnostics.some(d=>d.blocking&&/TS2583/.test(d.diagnostic)))
 }finally{rmSync(dir,{recursive:true,force:true})}
})
