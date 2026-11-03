import assert from "node:assert/strict"
import {test} from "node:test"
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync,cpSync} from "node:fs"
import {join,dirname} from "node:path"
import {tmpdir} from "node:os"
import {createRequire} from "node:module"
import {publishedEntrypoints,compareApiIdentity} from "./api-identity.mjs"
import {checkProperty} from "./testing/property.mjs"
const require=createRequire(new URL("../docs/tools/package.json",import.meta.url))
const ts=require("typescript"),fc=require("fast-check")
function fixture({extension="ts",sourceExtension="ts",prefix="./*",hidden=false,sourceFirst=false,names=["one","two"]}={},fn) {
 const root=mkdtempSync(join(tmpdir(),"api-identity-wildcard-conditions-"))
 const pkg=join(root,"node_modules/fixture")
 const put=(name,text)=>{mkdirSync(dirname(join(pkg,name)),{recursive:true});writeFileSync(join(pkg,name),text)}
 try {
  const typed=["types",`./lib/*/index.d.${extension}`],source=["bun",`./src/*/index.${sourceExtension}`]
  const branches=Object.fromEntries(sourceFirst?[source,typed]:[typed,source])
  const exports={[prefix]:{...branches,default:`./lib/*/index.${extension==="mts"?"mjs":extension==="cts"?"cjs":"js"}`},...(hidden?{[prefix.replace("*","private/*")]:null}:{})}
  put("package.json",JSON.stringify({name:"fixture",type:"module",exports}))
  for(const name of names) {
   put(`lib/${name}/index.d.${extension}`,"export type X=string;")
   put(`src/${name}/index.${sourceExtension}`,"export type X=string;")
  }
  if(hidden)put(`lib/private/hidden/index.d.${extension}`,"export type Hidden=boolean;")
  return fn(pkg,root)
 } finally {rmSync(root,{recursive:true,force:true})}
}
function expected(pkg,names,prefix="./*") {
 return Object.fromEntries(names.map(name=>[prefix.replace("*",name),join(pkg,"lib",name,"index.d.ts")]))
}
test("Alchemy conditional wildcard ignores an unreachable source pattern",()=>{
 const corpus=JSON.parse(readFileSync(new URL("./api-identity-corpus/alchemy-conditional-wildcard-exports.json",import.meta.url)))
 fixture({},pkg=>{
  writeFileSync(join(pkg,"package.json"),JSON.stringify(corpus.manifest))
  for(const [name,text] of Object.entries(corpus.files)){mkdirSync(dirname(join(pkg,name)),{recursive:true});writeFileSync(join(pkg,name),text)}
  assert.deepEqual(Object.keys(publishedEntrypoints(pkg,ts)).sort(),corpus.expectedEntrypoints)
 })
})
test("conditional wildcard package compared with itself is API-identical",()=>{
 fixture({},pkg=>{
  const result=compareApiIdentity(ts,pkg,pkg)
  assert.equal(result.comparisonComplete,true,JSON.stringify(result))
  assert.equal(result.identical,true,JSON.stringify(result))
 })
})
test("a selected wildcard type change has an export diagnostic",()=>{
 fixture({},(pkg,root)=>{
  const after=join(root,"node_modules/after");cpSync(pkg,after,{recursive:true})
  writeFileSync(join(after,"lib/one/index.d.ts"),"export type X=number;")
  const result=compareApiIdentity(ts,pkg,after)
  assert.equal(result.comparisonComplete,true,JSON.stringify(result))
  assert.ok(result.typeDifferences.some(x=>x.entrypoint==="./one"&&x.export==="X"&&/TS2344/.test(x.diagnostic)),JSON.stringify(result))
 })
})
test("wildcard exclusions do not leave a literal pattern entry",()=>{
 fixture({hidden:true},pkg=>assert.deepEqual(publishedEntrypoints(pkg,ts),expected(pkg,["one","two"])))
})
test("an unrepresented reachable source export cannot be proved identical",()=>{
 fixture({sourceFirst:true},(pkg,root)=>{
  const after=join(root,"node_modules/after");cpSync(pkg,after,{recursive:true})
  writeFileSync(join(after,"src/one/index.ts"),"export type X=number;")
  assert.equal(compareApiIdentity(ts,pkg,after).identical,false)
 })
})
test("source-only names under a fallback wildcard cannot disappear",()=>{
 fixture({},(pkg,root)=>{
  mkdirSync(join(pkg,"src/extra"),{recursive:true})
  writeFileSync(join(pkg,"src/extra/index.ts"),"export type X=boolean;")
  const after=join(root,"node_modules/after");cpSync(pkg,after,{recursive:true})
  writeFileSync(join(after,"src/extra/index.ts"),"export type X=number;")
  assert.equal(compareApiIdentity(ts,pkg,after).identical,false)
 })
})
test("property: shadowed wildcard branches match stock tsc",async()=>{
 await checkProperty(fc,{
  name:"api-identity-shadowed-conditional-wildcard",
  rule:"Published names and types come from the entrypoint TypeScript resolves. Unreachable conditional wildcard alternatives are not additional published names.",
  command:"node --test scripts/api-identity-wildcard-conditions.test.mjs",
  arbitrary:fc.record({prefix:fc.constantFrom("./*","./feature/*"),hidden:fc.boolean(),extension:fc.constantFrom("ts","mts","cts")}),
  numRuns:24,
  check:({prefix,hidden,extension})=>fixture({prefix,hidden,extension,sourceExtension:extension},(pkg,root)=>{
   const entries=publishedEntrypoints(pkg,ts)
   assert.deepEqual(Object.keys(entries).sort(),["one","two"].map(n=>prefix.replace("*",n)).sort())
   for(const [subpath,file] of Object.entries(entries)) for(const extra of [[],["bun"]]) for(const mode of [ts.ModuleKind.ESNext,ts.ModuleKind.CommonJS]) {
    const actual=ts.resolveModuleName("fixture"+subpath.slice(1),join(root,"consumer.ts"),{module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,customConditions:extra},ts.sys,undefined,undefined,mode).resolvedModule?.resolvedFileName
    assert.equal(file,actual)
   }
  })
 })
})


test("a star in a literal export target does not turn its root into a wildcard",()=>{
 fixture({prefix:"."},pkg=>{
  const entries=publishedEntrypoints(pkg,ts)
  assert.ok(Object.values(entries).every(path=>path.includes("*")),JSON.stringify(entries))
  const result=compareApiIdentity(ts,pkg,pkg)
  assert.equal(result.comparisonComplete,false,JSON.stringify(result))
  assert.equal(result.typeDifferences.length,0,JSON.stringify(result))
 })
})
