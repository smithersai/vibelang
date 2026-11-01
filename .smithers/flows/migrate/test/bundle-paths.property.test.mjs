import assert from "node:assert/strict"
import {mkdtempSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname,join} from "node:path"
import {createRequire} from "node:module"
import {test} from "node:test"
import {spawnSync} from "node:child_process"
import {pathReadDeferrals} from "../lib/references.mjs"
import {checkProperty} from "../../../../scripts/testing/property.mjs"
const fc=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))("fast-check")
const rule="Source-text assertions remain protected."
const put=(r,f,s)=>{mkdirSync(dirname(join(r,f)),{recursive:true});writeFileSync(join(r,f),s)}
function scenario({pkg="client",name="mcp",nested=false,kind="dot",quoted=false,pathKind="package"}={}){
 const root=mkdtempSync(join(tmpdir(),"bundle-input-paths-"))
 try{
  const dir="packages/"+pkg,source=dir+"/src/"+(nested?"deep/":"")+name+".ts",candidate=dir+"/src/effect/index.ts"
  const native="src/"+(nested?"deep/":"")+name+".ts",reader=dir+"/test/import-boundaries.test.ts"
  put(root,"package.json","{}");put(root,dir+"/package.json",JSON.stringify({exports:{"./mcp":"./"+native}}))
  for(const f of [source,candidate,"packages/other/src/index.ts"])put(root,f,"export const value = 42\n")
  put(root,"packages/other/package.json","{}")
  const access=kind==="dot"?"build.metafile.inputs":'build["metafile"]["inputs"]'
  const expected=pathKind==="root"?JSON.stringify(source):pathKind==="relative"?JSON.stringify("../"+native):pathKind==="absolute"?JSON.stringify(join(root,source)):pathKind==="url"?'new URL('+JSON.stringify("../"+native)+', import.meta.url).pathname':JSON.stringify(native)
  const observation="const build=await Bun.build({entrypoints:['entry.ts'],metafile:true});\nexpect(Object.keys("+access+")).toContain("+expected+");\n"
  const text=quoted?"// "+observation.replaceAll("\n","\n// ")+"\nconst example = "+JSON.stringify(observation)+";\n":observation
  put(root,reader,text)
  const files=[source,candidate,reader,"packages/other/src/index.ts"]
  const result=pathReadDeferrals(root,[candidate,"packages/other/src/index.ts"],files)
  assert.deepEqual(result.map(d=>d.file),quoted?[]:[candidate])
  if(!quoted){assert.match(result[0].reason,/BUNDLE-INPUT-PATHS/);assert.ok(result[0].reason.includes(reader));assert.ok(result[0].reason.includes(source))}
  assert.equal(readFileSync(join(root,reader),"utf8"),text)
 }finally{rmSync(root,{recursive:true,force:true})}
}
test("opencode-57: unrelated migration retains native bundle input paths",()=>scenario())
test("bundle-input deferral oracle quotes the protected-test rule",()=>assert.ok(readFileSync(new URL("../README.md",import.meta.url),"utf8").includes(rule)))
test("property: protected bundle input paths defer only candidates in the observed package",async()=>{
 await checkProperty(fc,{name:"bundle-input-paths",rule,command:"node --test .smithers/flows/migrate/test/bundle-paths.property.test.mjs",regressions:new URL("./corpus/",import.meta.url),numRuns:120,
 arbitrary:fc.record({pkg:fc.constantFrom("client","sdk","client-kit"),name:fc.constantFrom("mcp","service","a..b"),nested:fc.boolean(),kind:fc.constantFrom("dot","bracket"),quoted:fc.boolean(),pathKind:fc.constantFrom("package","root","relative","absolute","url")}),check:scenario})
})
test("normal source reads still defer their module without deferring unrelated package candidates",()=>{
 const root=mkdtempSync(join(tmpdir(),"source-read-paths-"))
 try{
  put(root,"package.json","{}");put(root,"src/a.ts","");put(root,"src/b.ts","")
  put(root,"test/a.test.ts",'assert.match(readFileSync("../src/a.ts","utf8"),/value/)\n')
  assert.deepEqual(pathReadDeferrals(root,["src/a.ts","src/b.ts"],["src/a.ts","src/b.ts","test/a.test.ts"]).map(d=>d.file),["src/a.ts"])
 }finally{rmSync(root,{recursive:true,force:true})}
})

test("opencode-57: the unchanged Bun metafile assertion keeps passing after protected scope planning",()=>{
 const root=mkdtempSync(join(tmpdir(),"opencode-bundle-path-"))
 try{
  const pkg={name:"@demo/client",type:"module",exports:{"./mcp":"./src/mcp.ts"}}
  put(root,"package.json",JSON.stringify(pkg));put(root,"src/mcp.ts","export const answer: number = 42\n");put(root,"src/effect/index.ts","export const unrelated = 1\n")
  put(root,"entry.ts",'import {answer} from "@demo/client/mcp"; console.log(answer)\n')
  mkdirSync(join(root,"node_modules/@demo"),{recursive:true});symlinkSync(root,join(root,"node_modules/@demo/client"))
  const source='import assert from "node:assert/strict"; const build=await Bun.build({entrypoints:["entry.ts"],target:"bun",metafile:true}); assert.equal(build.success,true); assert.ok(Object.keys(build.metafile.inputs).includes("src/mcp.ts"));\n'
  put(root,"test/import-boundaries.test.ts",source)
  const check=()=>{const r=spawnSync("bun",["test/import-boundaries.test.ts"],{cwd:root,encoding:"utf8",timeout:30000});assert.equal(r.status,0,(r.stdout??"")+(r.stderr??""))}
  check()
  const selected=["src/effect/index.ts"]
  const deferred=pathReadDeferrals(root,selected,["src/mcp.ts","src/effect/index.ts","test/import-boundaries.test.ts"])
  assert.deepEqual(deferred.map(d=>d.file),selected)
  assert.equal(readFileSync(join(root,"package.json"),"utf8"),JSON.stringify(pkg))
  assert.equal(readFileSync(join(root,"test/import-boundaries.test.ts"),"utf8"),source)
  check()
 }finally{rmSync(root,{recursive:true,force:true})}
})
