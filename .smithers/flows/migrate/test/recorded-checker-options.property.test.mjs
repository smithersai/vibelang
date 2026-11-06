import assert from "node:assert/strict"
import {test} from "node:test"
import {spawn} from "node:child_process"
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs"
import {dirname,join} from "node:path"
import {tmpdir} from "node:os"
import {createRequire} from "node:module"
import {compareDeclarations,recordDeclarationSurface} from "../lib/declarations.mjs"
const require=createRequire(new URL("../../../../docs/tools/package.json",import.meta.url))
const ts=require("typescript")
const put=(root,file,text)=>{const path=join(root,file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,typeof text==="string"?text:JSON.stringify(text))}

// Stock TypeScript accepts each source only under its project's own option, so
// the comparison program has to check declarations under that option too.
function compare({before,after=before,legacyBefore=false,options:extra={},...controls}){
 const root=mkdtempSync(join(tmpdir(),"recorded-checker-options-"))
 try{
  const snapshots=[]
  for(const [side,source] of [["before",before],["after",after]]){
   const pkg=join(root,side,"package"),snapshot=join(root,side,"snapshot")
   mkdirSync(snapshot,{recursive:true})
   put(pkg,"package.json",{name:"recorded-checker-fixture",type:"module",exports:{".":{types:"./dist/index.d.ts"}}})
   put(pkg,"index.ts",source)
   const options={strict:true,exactOptionalPropertyTypes:true,skipLibCheck:true,target:"ESNext",module:"ESNext",moduleResolution:"Bundler",lib:["ESNext"],types:[],rootDir:".",outDir:"dist",declaration:true,...extra}
   put(pkg,"tsconfig.json",{compilerOptions:options,files:["index.ts"]})
   const parsed=ts.getParsedCommandLineOfConfigFile(join(pkg,"tsconfig.json"),{}, {...ts.sys,onUnRecoverableConfigFileDiagnostic:d=>{throw Error(String(d.code))}})
   const program=ts.createProgram(parsed.fileNames,{...parsed.options,noEmit:false,emitDeclarationOnly:true,outDir:snapshot})
   assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>d.code),[],"the original project is valid stock TypeScript")
   assert.equal(program.emit().emitSkipped,false)
   recordDeclarationSurface(ts,snapshot,pkg,[{tsconfig:"tsconfig.json",prefix:"."}])
   if(side==="before"&&legacyBefore){
    const file=join(snapshot,"public-surface.json"),surface=JSON.parse(readFileSync(file))
    for(const context of surface.apiMetadata.projectContexts)delete context.compilerOptions.exactOptionalPropertyTypes
    writeFileSync(file,JSON.stringify(surface))
   }
   snapshots.push(snapshot)
  }
  return compareDeclarations(ts,snapshots[0],snapshots[1],{canonical:true,includePrivate:true,...controls})
 }finally{rmSync(root,{recursive:true,force:true})}
}

const keybindings="export interface When { [key: string]: boolean; editableFocus?: boolean }\n"

test("a declaration valid only under the project's exactOptionalPropertyTypes compares complete and identical",()=>{
 const result=compare({before:keybindings})
 assert.deepEqual(result.environmentDiagnostics,[])
 assert.equal(result.comparisonComplete,true)
 assert.equal(result.identical,true)
})

test("a snapshot recorded before the option was kept still compares under the other side's option",()=>{
 const result=compare({before:keybindings,legacyBefore:true})
 assert.deepEqual(result.environmentDiagnostics,[])
 assert.equal(result.identical,true)
})

const worker="export type WorkerContext = WorkerGlobalScope;\n"

test("a global from the project's lib compares complete and identical (drive-t3code)",()=>{
 const result=compare({before:worker,options:{lib:["ES2023","WebWorker"]}})
 assert.deepEqual(result.environmentDiagnostics.filter(d=>d.blocking),[])
 assert.equal(result.comparisonComplete,true)
 assert.equal(result.identical,true)
})

test("a name no selected library declares stays refused",()=>{
 const missing="export type Missing = NoSuchGlobalAnywhere;\n"
 assert.throws(()=>compare({before:missing,options:{lib:["ES2023","WebWorker"]}}),/2304|valid stock TypeScript/)
})

test("a worker heap list reaches the comparison: one too small to run fails it, never reads as identical",()=>{
 const result=compare({before:keybindings,workerHeaps:[1]})
 assert.equal(result.identical,false)
 assert.equal(result.comparisonComplete,false)
})

// The drive set entryBatchSize to cut a whole-application API check and the
// facade dropped it, so the run kept the default groups of eight entries.
for(const key of ["entryBatchSize","probeBatchSize","diagnosticBatchSize"]){
 test(`${key} reaches the comparison: an invalid 0 is refused, never replaced by the default`,()=>{
  const result=compare({before:keybindings,[key]:0})
  assert.equal(result.identical,false)
  assert.equal(result.comparisonComplete,false)
 })
 test(`${key} 1 still compares complete and identical`,()=>{
  const result=compare({before:keybindings,[key]:1})
  assert.equal(result.comparisonComplete,true)
  assert.equal(result.identical,true)
 })
}

test("an option compareDeclarations does not know is refused, not dropped",()=>{
 assert.throws(()=>compare({before:keybindings,entryBatchSise:64}),/unknown option entryBatchSise/)
})

test("profiled stage records stream while the comparison runs",async()=>{
 const script=`
import {createRequire} from "node:module"
import {mkdirSync,mkdtempSync,writeFileSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {compareDeclarations} from ${JSON.stringify(new URL("../lib/declarations.mjs",import.meta.url).href)}
const ts=createRequire(${JSON.stringify(new URL("../../../../docs/tools/package.json",import.meta.url).href)})("typescript")
const root=mkdtempSync(join(tmpdir(),"api-profile-"))
for(const side of ["a","b"]){mkdirSync(join(root,side));writeFileSync(join(root,side,"index.d.ts"),"export declare const n: number\\n");writeFileSync(join(root,side,"package.json"),'{"name":"p","types":"./index.d.ts"}')}
compareDeclarations(ts,join(root,"a"),join(root,"b"),{canonical:true,profile:true})
`
 const child=spawn(process.execPath,["--input-type=module","-e",script],{stdio:["ignore","ignore","pipe"]})
 let first,text=""
 child.stderr.on("data",data=>{first??=performance.now();text+=data})
 const closed=await new Promise(done=>child.on("close",()=>done(performance.now())))
 assert.match(text,/"stage"/)
 assert.ok(closed-first>100,"the first record arrived "+(closed-first)+" ms before the worker's parent exited")
})
