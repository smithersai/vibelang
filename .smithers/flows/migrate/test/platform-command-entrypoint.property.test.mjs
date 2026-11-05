import assert from "node:assert/strict"
import {test} from "node:test"
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from "node:fs"
import {dirname,join} from "node:path"
import {tmpdir} from "node:os"
import {createRequire} from "node:module"
import {compareDeclarations} from "../lib/declarations.mjs"
import {SpecPath} from "../../../../scripts/testing/spec-path.mjs"
import {checkProperty} from "../../../../scripts/testing/property.mjs"
const require=createRequire(new URL("../../../../docs/tools/package.json",import.meta.url))
const ts=require("typescript"),fc=require("fast-check")
const corpus=JSON.parse(readFileSync(new URL("./corpus/t3code-platform-command-entrypoint.json",import.meta.url)))
const put=(dir,file,text)=>{const path=join(dir,file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text)}
test("platform command entrypoints quote the API identity contract",()=>{
 assert.ok(readFileSync(SpecPath("001-functions.md"),"utf8").includes(corpus.quote))
})
test("stock TypeScript emits the minimized command's unchanged empty surface",()=>{
 const root=mkdtempSync(join(tmpdir(),"platform-command-emit-"))
 try{
  put(root,"original.ts",corpus.original)
  put(root,"split.ts",corpus.facade)
  put(root,"cli.platform.ts",corpus.helper)
  const program=ts.createProgram([join(root,"original.ts"),join(root,"split.ts")],{
   declaration:true,emitDeclarationOnly:true,outDir:join(root,"out"),strict:true,types:[],lib:["lib.es5.d.ts"],
   module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler})
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>d.code),[])
  assert.equal(program.emit().emitSkipped,false)
  for(const file of ["original","split"])assert.equal(readFileSync(join(root,"out",file+".d.ts"),"utf8").trim(),"export {};")
  assert.match(readFileSync(join(root,"out/cli.platform.d.ts"),"utf8"),/export declare const main = 0/)
 }finally{rmSync(root,{recursive:true,force:true})}
})
function witness({exposure="open",depth=0,split=true,helperType="number"}={}){
 const root=mkdtempSync(join(tmpdir(),"platform-command-entrypoint-"))
 const script="scripts/"+"nested/".repeat(depth)+"cli"
 const helper=script+".platform.d.ts"
 let manifest={name:"command-entrypoint-fixture",type:"module",types:"./public.d.ts"}
 if(exposure==="closed")manifest.exports={".":"./public.js"}
 if(exposure==="explicit")manifest.exports={".":"./public.js","./command":"./"+script+".js"}
 if(exposure==="pattern")manifest.exports={".":"./public.js","./scripts/*.js":"./scripts/*.js"}
 if(exposure==="files")manifest.files=["public.d.ts",script+".d.ts"]
 try{
  for(const side of ["before","after"]){
   const dir=join(root,side)
   put(dir,"package.json",JSON.stringify(manifest));put(dir,"public.d.ts","export declare const anchor: number;")
   put(dir,script+".d.ts","export {};")
   if(side==="after"&&split)put(dir,helper,"export declare const main: "+helperType+";")
  }
  const result=compareDeclarations(ts,join(root,"before"),join(root,"after"))
  const addedPublic=split&&["open","pattern"].includes(exposure)
  assert.equal(result.comparisonComplete,true,JSON.stringify(result))
  assert.equal(result.identical,!addedPublic,JSON.stringify(result))
  assert.deepEqual(result.typeDifferences,[]);assert.deepEqual(result.docDifferences,[])
  if(addedPublic){
   assert.deepEqual(result.nameDifferences,[{entrypoint:"./"+script+".platform.js",export:"*",side:"after"}])
  }else{
   assert.deepEqual(result.nameDifferences,[])
   if(split)assert.ok(result.addedPrivate.includes(helper),JSON.stringify(result))
  }
 }finally{rmSync(root,{recursive:true,force:true})}
}
test("T3 Code platform splitting adds a shipped deep command entrypoint",()=>witness())
test("preserving the original TypeScript command keeps the same public surface",()=>witness({split:false}))
for(const exposure of ["closed","explicit","files","pattern"])test("platform companion respects "+exposure+" publication",()=>witness({exposure}))
test("property: companion visibility follows actual publication instead of empty facade exports",async()=>{
 await checkProperty(fc,{name:corpus.key,rule:corpus.quote,
 command:"node --test .smithers/flows/migrate/test/platform-command-entrypoint.property.test.mjs",numRuns:24,
 arbitrary:fc.record({exposure:fc.constantFrom("open","closed","explicit","files","pattern"),depth:fc.integer({min:0,max:2}),split:fc.boolean(),helperType:fc.constantFrom("number","string","()=>number","{readonly value:number}")}),check:witness})
})
