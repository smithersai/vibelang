import assert from "node:assert/strict"
import {test} from "node:test"
import {mkdirSync,mkdtempSync,writeFileSync,rmSync,cpSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {createRequire} from "node:module"
import {publishedEntrypoints,compareApiIdentity} from "./api-identity.mjs"
import {checkProperty} from "./testing/property.mjs"
const require=createRequire(new URL("../docs/tools/package.json",import.meta.url))
const ts=require("typescript"),fc=require("fast-check")
function fixture(targets,fn) {
 const root=mkdtempSync(join(tmpdir(),"api-identity-conditions-"))
 const pkg=join(root,"node_modules/fixture")
 try {
  mkdirSync(pkg,{recursive:true})
  writeFileSync(join(pkg,"package.json"),JSON.stringify({name:"fixture",type:"module",exports:{".":targets}}))
  for(const name of ["first","second","third"])
   writeFileSync(join(pkg,name+".d.ts"),"export type X=string;")
  return fn(pkg,root)
 } finally {rmSync(root,{recursive:true,force:true})}
}
function check(targets) {
 fixture(targets,(pkg,root)=>{
  const expected=[...new Set([ts.ModuleKind.ESNext,ts.ModuleKind.CommonJS].map(mode=>
   ts.resolveModuleName("fixture",join(root,"consumer.ts"),{module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler},ts.sys,undefined,undefined,mode).resolvedModule?.resolvedFileName
  ).filter(Boolean))].sort()
  assert.deepEqual([...new Set(Object.values(publishedEntrypoints(pkg,ts)))].sort(),expected,JSON.stringify(targets))
 })
}
test("default before types selects the first resolved condition",()=>check({default:"./first.js",types:"./second.d.ts"}))
test("types before default selects types",()=>check({types:"./second.d.ts",default:"./first.js"}))
test("import and require before types retain their selected declaration surfaces",()=>check({import:"./first.js",require:"./third.js",types:"./second.d.ts"}))
test("nested condition objects preserve declaration condition order",()=>check({import:{default:"./first.js",types:"./second.d.ts"},require:{types:"./third.d.ts",default:"./second.js"}}))
test("null conditional alternatives follow stock tsc selection",()=>check({default:null,types:"./second.d.ts"}))
test("an absent earlier target still permits a later resolvable condition",()=>check({default:"./missing.js",types:"./second.d.ts"}))
test("selected semantic changes fail while unreachable types changes pass",()=>{
 fixture({default:"./first.js",types:"./second.d.ts"},(pkg,root)=>{
  const after=join(root,"node_modules/after");cpSync(pkg,after,{recursive:true})
  writeFileSync(join(after,"second.d.ts"),"export type X=boolean;")
  assert.equal(compareApiIdentity(ts,pkg,after).identical,true)
  writeFileSync(join(after,"first.d.ts"),"export type X=number;")
  const result=compareApiIdentity(ts,pkg,after)
  assert.equal(result.comparisonComplete,true,JSON.stringify(result))
  assert.ok(result.typeDifferences.some(d=>d.export==="X"),JSON.stringify(result))
 })
})
test("property: ordered conditional candidates match stock tsc",async()=>{
 await checkProperty(fc,{
  name:"api-identity-conditional-object-order",
  rule:"Published names and types come from the entrypoint TypeScript resolves. An earlier matching export condition can shadow a later types condition.",
  command:"node --test scripts/api-identity-conditions.test.mjs",
  arbitrary:fc.record({defaultFirst:fc.boolean(),branch:fc.constantFrom("default","import","require"),missing:fc.boolean()}),
  numRuns:24,
  check:({defaultFirst,branch,missing})=>{
   const conditional=[branch,missing?"./missing.js":"./first.js"],typed=["types","./second.d.ts"]
   check(Object.fromEntries(defaultFirst?[conditional,typed]:[typed,conditional]))
  }
 })
})


test("published source exports resolve mirrored sidecars without hiding real changes",()=>{
 for(const inherited of [false,true]){
  fixture({types:"./src/value.vibe",default:"./lib/value.js"},(pkg,root)=>{
   mkdirSync(join(pkg,"src"),{recursive:true})
   mkdirSync(join(pkg,".cache/types/src"),{recursive:true})
   writeFileSync(join(pkg,"src/value.vibe"),"export effect function neverParseThis() { try sleep(1) }")
   writeFileSync(join(pkg,".cache/types/src/value.d.vibe.ts"),"export type X=string;")
   if(inherited){
    writeFileSync(join(pkg,"base.json"),JSON.stringify({vibe:{sidecarDir:".cache/types"}}))
    writeFileSync(join(pkg,"tsconfig.json"),JSON.stringify({extends:"./base.json",compilerOptions:{rootDirs:[".",".cache/types"]}}))
   }else writeFileSync(join(pkg,"tsconfig.json"),JSON.stringify({compilerOptions:{rootDirs:[".",".cache/types"]},vibe:{sidecarDir:".cache/types"}}))
   const after=join(root,"node_modules/after");cpSync(pkg,after,{recursive:true})
   assert.ok(Object.keys(publishedEntrypoints(pkg,ts)).length>0)
   for(const [a,b]of [[pkg,pkg],[pkg,after]]){
    const result=compareApiIdentity(ts,a,b)
    assert.equal(result.identical,true,JSON.stringify(result))
   }
   writeFileSync(join(after,".cache/types/src/value.d.vibe.ts"),"export type X=number;")
   const changed=compareApiIdentity(ts,pkg,after)
   assert.equal(changed.comparisonComplete,true,JSON.stringify(changed))
   assert.ok(changed.typeDifferences.some(d=>d.export==="X"),JSON.stringify(changed))
  })
 }
})
