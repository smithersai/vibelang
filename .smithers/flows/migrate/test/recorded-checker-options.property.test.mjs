import assert from "node:assert/strict"
import {test} from "node:test"
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
function compare({before,after=before,legacyBefore=false}){
 const root=mkdtempSync(join(tmpdir(),"recorded-checker-options-"))
 try{
  const snapshots=[]
  for(const [side,source] of [["before",before],["after",after]]){
   const pkg=join(root,side,"package"),snapshot=join(root,side,"snapshot")
   mkdirSync(snapshot,{recursive:true})
   put(pkg,"package.json",{name:"recorded-checker-fixture",type:"module",exports:{".":{types:"./dist/index.d.ts"}}})
   put(pkg,"index.ts",source)
   const options={strict:true,exactOptionalPropertyTypes:true,skipLibCheck:true,target:"ESNext",module:"ESNext",moduleResolution:"Bundler",lib:["ESNext"],types:[],rootDir:".",outDir:"dist",declaration:true}
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
  return compareDeclarations(ts,snapshots[0],snapshots[1],{canonical:true,includePrivate:true})
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
