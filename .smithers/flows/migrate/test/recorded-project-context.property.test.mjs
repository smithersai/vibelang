import assert from "node:assert/strict"
import {test} from "node:test"
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,symlinkSync,rmSync} from "node:fs"
import {dirname,join} from "node:path"
import {tmpdir} from "node:os"
import {createRequire} from "node:module"
import {compareDeclarations,recordDeclarationSurface} from "../lib/declarations.mjs"
import {SpecPath} from "../../../../scripts/testing/spec-path.mjs"
import {checkProperty} from "../../../../scripts/testing/property.mjs"
const require=createRequire(new URL("../../../../docs/tools/package.json",import.meta.url))
const runtimeRequire=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))
const ts=require("typescript"),fc=require("fast-check")
const nodeTypes=dirname(runtimeRequire.resolve("@types/node/package.json"))
const corpus=JSON.parse(readFileSync(new URL("./corpus/t3code-recorded-project-context.json",import.meta.url)))
const put=(root,file,text)=>{const path=join(root,file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,typeof text==="string"?text:JSON.stringify(text))}
test("recorded project contexts quote the declaration identity contract",()=>{
 assert.ok(readFileSync(SpecPath("001-functions.md"),"utf8").includes(corpus.quote))
})
function witness({mode="explicit",extension=".ts",depth=0,prefix=".",nestedConfig=false,mutation="same",handwritten=false,outside=false}={}){
 const root=mkdtempSync(join(tmpdir(),"recorded-project-context-")),snapshots=[],inputs=[]
 const source="nested/".repeat(depth)+"index"+(handwritten?(extension===".mts"?".d.mts":extension===".cts"?".d.cts":".d.ts"):extension)
 const declaration=handwritten?source:source.replace(/\.[^.]+$/,extension===".mts"?".d.mts":extension===".cts"?".d.cts":".d.ts")
 const sourceType=["custom","automaticLocal"].includes(mode)?"LocalEnvironment.Record":mode==="empty"?"Record<string, string | undefined>":"NodeJS.ProcessEnv"
 try{
  for(const side of ["before","after"]){
   const pkg=join(root,side,"package"),snapshot=join(root,side,"snapshot")
   mkdirSync(snapshot,{recursive:true})
   mkdirSync(join(pkg,"node_modules/@types"),{recursive:true})
   symlinkSync(nodeTypes,join(pkg,"node_modules/@types/node"),"dir")
   const target=(handwritten?"./":outside?"../published/":"./dist/")+declaration
   const manifest={name:"recorded-context-fixture",type:"module",...(outside?{types:target}:{exports:{".":{types:target}}})}
   put(pkg,"package.json",manifest)
   let original=corpus.source.replaceAll("NodeJS.ProcessEnv",sourceType)
   if(handwritten)original=original.replace("export const","export declare const").replace(" = {}","")
   put(pkg,source,original)
   const config=nestedConfig?"config/build.json":"tsconfig.json",up=nestedConfig?"../":""
   const options={strict:true,skipLibCheck:true,target:"ESNext",module:"ESNext",moduleResolution:"Bundler",lib:["ESNext"],rootDir:up||".",outDir:up+(outside?"../published":"dist"),declaration:true}
   if(!["automatic","automaticLocal"].includes(mode))options.types=mode==="custom"?["local"]:mode==="empty"?[]:["node"]
   if(mode==="roots"||mode==="extends")options.typeRoots=[dirname(nodeTypes)]
   if(mode==="automaticLocal")put(pkg,"node_modules/@types/local/index.d.ts","declare namespace LocalEnvironment { interface Record { [key:string]: string | undefined } }")
   if(mode==="custom"){
    options.typeRoots=[up+"typings"]
    put(pkg,"typings/local/index.d.ts","declare namespace LocalEnvironment { interface Record { [key:string]: string | undefined } }")
   }
   const raw={compilerOptions:options,files:[up+source]}
   if(mode==="extends"){
    put(pkg,"base.json",{compilerOptions:{types:options.types,typeRoots:options.typeRoots}})
    delete options.types;delete options.typeRoots;raw.extends=(nestedConfig?"../":"./")+"base.json"
   }
   put(pkg,config,raw)
   const parsed=ts.getParsedCommandLineOfConfigFile(join(pkg,config),{}, {...ts.sys,onUnRecoverableConfigFileDiagnostic:d=>{throw Error(String(d.code))}})
   assert.deepEqual(parsed.errors.map(d=>d.code),[])
   const program=ts.createProgram(parsed.fileNames,{...parsed.options,noEmit:false,noEmitOnError:true,emitDeclarationOnly:true,outDir:join(snapshot,prefix)})
   assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>d.code),[],"the original project is valid stock TypeScript")
   assert.equal(program.emit().emitSkipped,false)
   recordDeclarationSurface(ts,snapshot,pkg,[{tsconfig:config,prefix}])
   const file=handwritten?join(snapshot,".migrate-shipped",source):join(snapshot,prefix,declaration)
   assert.ok(readFileSync(file,"utf8").includes(sourceType))
   if(mutation==="missing"){
    const surfaceFile=join(snapshot,"public-surface.json"),surface=JSON.parse(readFileSync(surfaceFile))
    delete surface.apiMetadata.projectContexts;writeFileSync(surfaceFile,JSON.stringify(surface))
   }
   let text=readFileSync(file,"utf8")
   if(side==="after"&&mutation==="type")text=text.replace(sourceType,"Readonly<Record<string, number>>")
   if(side==="after"&&mutation==="docs")text=text.replace("Reads","Retrieves")
   if(mutation==="forbiddenNode")text=text.replace(sourceType,"NodeJS.ProcessEnv")
   if(mutation==="lateType"){
    put(pkg,"node_modules/@types/later/index.d.ts","declare namespace LaterOnly { type Value = number }")
    text=text.replace(sourceType,"LaterOnly.Value")
   }
   writeFileSync(file,text)
   inputs.push([file,text])
   // Original configuration and ambient source bytes are mutable after setup.
   // The comparison must use the recorded context and shipped declarations.
   put(pkg,config,{compilerOptions:{types:[]},files:[]})
   if(handwritten)put(pkg,source,"export {};")
   if(mode==="extends")put(pkg,"base.json",{compilerOptions:{types:[]}})
   if(mode==="custom")put(pkg,"typings/local/index.d.ts","declare namespace LocalEnvironment { interface Record { forbidden: number } }")
   snapshots.push(snapshot)
  }
  const result=compareDeclarations(ts,...snapshots)
  const available=!["missing","forbiddenNode","lateType"].includes(mutation)
  assert.equal(result.comparisonComplete,available,JSON.stringify(result))
  assert.equal(result.identical,mutation==="same",JSON.stringify(result))
  if(mutation==="type")assert.ok(result.typeDifferences.length,JSON.stringify(result))
  if(mutation==="docs")assert.ok(result.docDifferences.length,JSON.stringify(result))
  if(!available)assert.ok(result.environmentDiagnostics.length,JSON.stringify(result))
  for(const[file,text]of inputs)assert.equal(readFileSync(file,"utf8"),text)
 }finally{rmSync(root,{recursive:true,force:true})}
}
for(const mode of ["explicit","automatic","automaticLocal","roots","extends","custom"])
 test("recorded "+mode+" project context survives an actual declaration emit and source-config change",()=>witness({mode}))
test("a project-owned handwritten declaration retains its recorded Node environment",()=>witness({handwritten:true}))
for(const mutation of ["type","docs","missing"])
 test("recorded project contexts retain "+mutation+" failures",()=>witness({mutation}))
test("automatic type names are frozen before later dependency installation",()=>witness({mode:"automatic",mutation:"lateType"}))
test("declarations outside the package retain their recorded project owner",()=>witness({outside:true,nestedConfig:true}))
test("an explicit empty types list does not acquire ambient Node declarations",()=>witness({mode:"empty",mutation:"forbiddenNode"}))
test("property: emitted snapshots freeze project type context across output layouts",async()=>{
 await checkProperty(fc,{name:corpus.key,rule:corpus.quote,
 command:"node --test .smithers/flows/migrate/test/recorded-project-context.property.test.mjs",numRuns:16,
 arbitrary:fc.record({mode:fc.constantFrom("explicit","automatic","automaticLocal","roots","extends","custom"),extension:fc.constantFrom(".ts",".tsx",".mts",".cts"),depth:fc.integer({min:0,max:2}),prefix:fc.constantFrom(".","esm"),nestedConfig:fc.boolean(),handwritten:fc.boolean(),mutation:fc.constantFrom("same","type","docs","missing")}),check:witness})
})

test("multiple recorded projects retain independent declaration ownership in either order",()=>{
 const root=mkdtempSync(join(tmpdir(),"recorded-project-owners-")),snapshots=[]
 try{
  for(const side of ["before","after"]){
   const pkg=join(root,side,"package"),snapshot=join(root,side,"snapshot")
   mkdirSync(snapshot,{recursive:true});mkdirSync(join(pkg,"node_modules/@types"),{recursive:true})
   symlinkSync(nodeTypes,join(pkg,"node_modules/@types/node"),"dir")
   put(pkg,"package.json",{name:"recorded-multiple-contexts",type:"module",exports:{"./node":{types:"./dist/node/index.d.ts"},"./local":{types:"./dist/local/index.d.ts"}}})
   put(pkg,"typings/local/index.d.ts","declare namespace LocalEnvironment { interface Value { readonly local: 1 } }")
   const projects=[]
   for(const kind of ["node","local"]){
    const config="tsconfig."+kind+".json"
    put(pkg,"src/"+kind+"/index.ts",kind==="node"?"export const env: NodeJS.ProcessEnv = {};":"export const env: LocalEnvironment.Value = {local:1};")
    put(pkg,config,{compilerOptions:{strict:true,skipLibCheck:true,module:"ESNext",moduleResolution:"Bundler",target:"ESNext",types:[kind],...(kind==="local"?{typeRoots:["./typings"]}:{}),rootDir:"src/"+kind,outDir:"dist/"+kind,declaration:true},files:["src/"+kind+"/index.ts"]})
    const parsed=ts.getParsedCommandLineOfConfigFile(join(pkg,config),{}, {...ts.sys,onUnRecoverableConfigFileDiagnostic:d=>{throw Error(String(d.code))}})
    const program=ts.createProgram(parsed.fileNames,{...parsed.options,emitDeclarationOnly:true,outDir:join(snapshot,kind)})
    assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>d.code),[])
    assert.equal(program.emit().emitSkipped,false);projects.push({tsconfig:config,prefix:kind})
   }
   recordDeclarationSurface(ts,snapshot,pkg,side==="after"?projects.reverse():projects)
   for(const {tsconfig}of projects)put(pkg,tsconfig,{compilerOptions:{types:[]},files:[]})
   snapshots.push(snapshot)
  }
  const result=compareDeclarations(ts,...snapshots)
  assert.equal(result.comparisonComplete,true,JSON.stringify(result))
  assert.equal(result.identical,true,JSON.stringify(result))
 }finally{rmSync(root,{recursive:true,force:true})}
})

for(const mode of ["baseUrl","local","inherited","absolute"]) test("recorded "+mode+" module-resolution paths survive source-config changes",()=>{
 const root=mkdtempSync(join(tmpdir(),"recorded-project-paths-")),snapshots=[]
 try{
  for(const side of ["before","after"]){
   const pkg=join(root,side,"package"),snapshot=join(root,side,"snapshot")
   mkdirSync(snapshot,{recursive:true})
   put(pkg,"package.json",{name:"recorded-paths-fixture",type:"module",types:"./dist/index.d.ts"})
   put(pkg,"src/index.ts",'import type { Value } from "@model/data"; export const value: Value = {data:1};')
   put(pkg,"src/model/data.ts","export interface Value { readonly data: number }")
   const options={strict:true,skipLibCheck:true,types:[],module:"ESNext",moduleResolution:"Bundler",target:"ESNext",rootDir:"../src",outDir:"../dist",declaration:true}
   const config={compilerOptions:options,files:["../src/index.ts","../src/model/data.ts"]}
   if(mode==="baseUrl"){options.baseUrl="..";options.paths={"@model/*":["src/model/*"]}}
   else if(mode==="local")options.paths={"@model/*":["../src/model/*"]}
   else if(mode==="absolute")options.paths={"@model/*":[join(pkg,"src/model/*")]}
   else{config.extends="./preset/base.json";put(pkg,"config/preset/base.json",{compilerOptions:{paths:{"@model/*":["../../src/model/*"]}}})}
   put(pkg,"config/build.json",config)
   const parsed=ts.getParsedCommandLineOfConfigFile(join(pkg,"config/build.json"),{}, {...ts.sys,onUnRecoverableConfigFileDiagnostic:d=>{throw Error(String(d.code))}})
   const program=ts.createProgram(parsed.fileNames,{...parsed.options,emitDeclarationOnly:true,outDir:snapshot})
   assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>d.code),[])
   assert.equal(program.emit().emitSkipped,false)
   recordDeclarationSurface(ts,snapshot,pkg,[{tsconfig:"config/build.json",prefix:"."}])
   put(pkg,"config/build.json",{compilerOptions:{types:[]},files:[]})
   if(mode==="inherited")put(pkg,"config/preset/base.json",{compilerOptions:{types:[]}})
   put(pkg,"src/model/data.ts","export interface Value { forbidden: "+(side==="before"?"string":"number")+" }")
   snapshots.push(snapshot)
  }
  const result=compareDeclarations(ts,...snapshots)
  assert.equal(result.comparisonComplete,true,JSON.stringify(result))
  assert.equal(result.identical,true,JSON.stringify(result))
 }finally{rmSync(root,{recursive:true,force:true})}
})
