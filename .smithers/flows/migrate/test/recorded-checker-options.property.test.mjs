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
// `stock` lists the codes stock TypeScript reports on the original project; the
// snapshot is still emitted (noEmitOnError is off) so the comparison sees it.
function compare({before,after=before,legacyBefore=false,options:extra={},stock=[],...controls}){
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
   assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>d.code),stock,"stock TypeScript's diagnostics on the original project")
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
 const result=compare({before:missing,options:{lib:["ES2023","WebWorker"]},stock:[2304]})
 assert.equal(result.identical,false)
 assert.equal(result.comparisonComplete,false)
 assert.ok(result.environmentDiagnostics.some(d=>d.blocking&&/NoSuchGlobalAnywhere/.test(d.diagnostic)),JSON.stringify(result.environmentDiagnostics))
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
 const marker="COMPARISON RETURNED "
 const script=`
import {createRequire} from "node:module"
import {mkdirSync,mkdtempSync,writeFileSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {compareDeclarations} from ${JSON.stringify(new URL("../lib/declarations.mjs",import.meta.url).href)}
const ts=createRequire(${JSON.stringify(new URL("../../../../docs/tools/package.json",import.meta.url).href)})("typescript")
const root=mkdtempSync(join(tmpdir(),"api-profile-"))
for(const side of ["a","b"]){mkdirSync(join(root,side));writeFileSync(join(root,side,"index.d.ts"),"export declare const n: number\\n");writeFileSync(join(root,side,"package.json"),'{"name":"p","types":"./index.d.ts"}')}
const result=compareDeclarations(ts,join(root,"a"),join(root,"b"),{canonical:true,profile:true})
console.error(${JSON.stringify(marker)}+JSON.stringify(result.identical))
`
 const child=spawn(process.execPath,["--input-type=module","-e",script],{stdio:["ignore","ignore","pipe"]})
 let text=""
 child.stderr.on("data",data=>{text+=data})
 const code=await new Promise(done=>child.on("close",done))
 assert.equal(code,0,text)
 const lines=text.split("\n"),end=lines.indexOf(marker+"true")
 assert.ok(end>0,"the comparison returned identical after its records: "+text)
 assert.ok(lines.slice(0,end).some(line=>/"stage"/.test(line)),"a stage record precedes the comparison's return: "+text)
 assert.ok(!lines.slice(end+1).some(line=>/"stage"/.test(line)),"no stage record is held back until after the return: "+text)
})
