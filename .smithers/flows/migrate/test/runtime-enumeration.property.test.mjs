import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname,join} from "node:path"
import {createRequire} from "node:module"
import {test} from "node:test"
import {pathReadDeferrals} from "../lib/references.mjs"
import {checkProperty} from "../../../../scripts/testing/property.mjs"
const fc=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))("fast-check")
const put=(r,f,s)=>{mkdirSync(dirname(join(r,f)),{recursive:true});writeFileSync(join(r,f),s)}
const rule="Type checkers use `.d.vibe.ts`; linters, Knip, bundlers and test runners read `.vibe`."
const helper='import path from "node:path"; const pkgName="@demo/plugin"; const realDir=path.dirname(Bun.resolveSync(pkgName+"/package.json",import.meta.dirname)); const rootEntry=Bun.resolveSync(pkgName,import.meta.dirname); const relParts=path.relative(realDir,rootEntry).replaceAll("\\\\","/").split("/"); const scanDir=relParts.length>1?path.join(realDir,relParts[0]):realDir; const ext=path.extname(rootEntry)||".js"; const entries=[]; for(const file of new Bun.Glob("**/*"+ext).scanSync({cwd:scanDir})){const base=file.slice(0,-ext.length); if(base!=="index")entries.push(pkgName+"/"+base)}; console.log(JSON.stringify(entries));\n'
function fixture(root){
 put(root,"package.json",'{"type":"module"}')
 put(root,"packages/plugin/package.json",JSON.stringify({name:"@demo/plugin",type:"module",exports:{".":"./src/index.ts","./package.json":"./package.json","./effect":"./src/effect.ts"}}))
 put(root,"packages/plugin/src/index.ts",'export {leaf} from "./leaf.ts"\n')
 put(root,"packages/plugin/src/leaf.ts","export const leaf=1\n")
 put(root,"packages/plugin/src/effect.ts","export const provided=42\n")
 put(root,"packages/plugin/src/runtime-modules.ts",helper)
 put(root,"packages/other/package.json",'{"name":"@demo/other"}')
 put(root,"packages/other/src/ok.ts","export const ok=1\n")
}
function scenario({engine="Bun.resolveSync",reader="scanSync",quoted=false,external=false}={}){
 const root=mkdtempSync(join(tmpdir(),"opencode-runtime-enumeration-"))
 try{
  fixture(root)
  const file=(external?"packages/other":"packages/plugin")+"/src/runtime-modules.ts"
  let source=helper.replaceAll("Bun.resolveSync",engine).replaceAll("scanSync",reader)
  if(quoted)source="// "+source.replaceAll("\n","\n// ")+"\nconst sample="+JSON.stringify(source)+";\n"
  put(root,file,source)
  const modules=["packages/plugin/src/index.ts","packages/plugin/src/leaf.ts","packages/other/src/ok.ts"]
  const files=[...modules,file]
  const result=pathReadDeferrals(root,modules,files)
  const expected=quoted?[]:external?modules:modules.slice(0,2)
  assert.deepEqual(result.map(r=>r.file),expected)
  if(!quoted)for(const receipt of result){assert.match(receipt.reason,/RUNTIME-SOURCE-ENUMERATION/);assert.ok(receipt.reason.includes(file))}
  assert.equal(readFileSync(join(root,file),"utf8"),source)
 }finally{rmSync(root,{recursive:true,force:true})}
}
test("opencode-59: runtime module enumeration keeps its package native",()=>scenario())
test("runtime enumeration oracle quotes chapter7",()=>assert.ok(readFileSync(new URL("../../../../docs/design/src/007-tooling.md",import.meta.url),"utf8").includes(rule)))
test("property: runtime enumeration guards owned and named packages without parsing quoted examples",()=>checkProperty(fc,{
 name:"runtime-source-enumeration",rule,command:"node --test .smithers/flows/migrate/test/runtime-enumeration.property.test.mjs",regressions:new URL("./corpus/",import.meta.url),numRuns:100,
 arbitrary:fc.record({engine:fc.constantFrom("Bun.resolveSync","require.resolve","import.meta.resolve"),reader:fc.constantFrom("scanSync","scan","readdirSync"),quoted:fc.boolean(),external:fc.boolean()}),check:scenario
}))
test("opencode-59: unchanged Opencode-style host enumeration survives protected scope planning",()=>{
 const root=mkdtempSync(join(tmpdir(),"opencode-runtime-enumeration-host-"))
 try{
  fixture(root)
  mkdirSync(join(root,"node_modules/@demo"),{recursive:true});symlinkSync(join(root,"packages/plugin"),join(root,"node_modules/@demo/plugin"))
  const host="packages/plugin/src/runtime-modules.ts",manifest="packages/plugin/package.json",original=readFileSync(join(root,manifest),"utf8")
  const run=()=>{const r=spawnSync("bun",[host],{cwd:root,encoding:"utf8",timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);return JSON.parse(r.stdout)}
  assert.ok(run().includes("@demo/plugin/effect"))
  for(const name of ["index","leaf","effect"])put(root,"packages/plugin/.vibelang/js/src/"+name+".js","export const value=1\n")
  const moved=JSON.parse(original);moved.exports["."]="./.vibelang/js/src/index.js"
  put(root,manifest,JSON.stringify(moved))
  assert.ok(!run().includes("@demo/plugin/effect"),"negative control: moving the root changes discovered virtual module names")
  put(root,manifest,original)
  const modules=["packages/plugin/src/index.ts","packages/plugin/src/leaf.ts","packages/other/src/ok.ts"]
  const deferred=pathReadDeferrals(root,modules,[...modules,host])
  assert.deepEqual(deferred.map(d=>d.file),modules.slice(0,2))
  assert.equal(readFileSync(join(root,host),"utf8"),helper)
  assert.equal(readFileSync(join(root,manifest),"utf8"),original)
  assert.ok(run().includes("@demo/plugin/effect"))
 }finally{rmSync(root,{recursive:true,force:true})}
})
