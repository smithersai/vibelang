import assert from "node:assert/strict"
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,rmSync} from "node:fs"
import {spawnSync} from "node:child_process"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {fileURLToPath} from "node:url"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"
import {makeConfig,wireTarget} from "../../../.smithers/flows/migrate/lib/steps.mjs"

export async function setupContract(group) {
  const issues=[]
  for(const flag of [undefined,false,true]) for(const inherited of [false,true]){
    const dir=mkdtempSync(join(tmpdir(),"vip27-setup-options-"))
    try{
      mkdirSync(join(dir,"src"));mkdirSync(join(dir,"node_modules"))
      symlinkSync(fileURLToPath(new URL("../../../packages/runtime/node_modules/typescript",import.meta.url)),join(dir,"node_modules/typescript"))
      writeFileSync(join(dir,"package.json"),'{"name":"fixture","private":true,"type":"module"}')
      const options={module:"Preserve",moduleResolution:"Bundler",noEmit:true,jsx:"preserve",types:[],...(flag===undefined?{}:{rewriteRelativeImportExtensions:flag})}
      if(group==="lint")options.plugins=[{name:"@effect/language-service",diagnosticSeverity:{floatingEffect:"error"}}]
      const cfg=inherited?{extends:"./base.json",include:["src"]}:{compilerOptions:options,include:["src"]}
      if(inherited)writeFileSync(join(dir,"base.json"),JSON.stringify({compilerOptions:options}))
      if(group==="lint"){cfg.vibe={severities:{EK3801:"error",EK38100:"off"}};cfg.exclude=["authored-exclusion"]}
      writeFileSync(join(dir,"tsconfig.json"),JSON.stringify(cfg))
      const source='import {value} from "./kept.js"; export const answer = value;'
      writeFileSync(join(dir,"src/main.ts"),source)
      writeFileSync(join(dir,"src/kept.tsx"),'export const value = "original" as const;')
      writeFileSync(join(dir,"src/kept.d.vibe.ts"),'export declare const value: "sidecar";')
      const parse=()=>ts.getParsedCommandLineOfConfigFile(join(dir,"tsconfig.json"),{}, {...ts.sys,onUnRecoverableConfigFileDiagnostic(d){throw Error(ts.flattenDiagnosticMessageText(d.messageText,"\n"))}})
      const before=parse()
      const resolve=options=>ts.resolveModuleName("./kept.js",join(dir,"src/main.ts"),options,ts.sys).resolvedModule.resolvedFileName
      assert.equal(resolve(before.options),join(dir,"src/kept.tsx"))
      assert.equal(resolve({...before.options,moduleSuffixes:["",".d.vibe"]}),join(dir,"src/kept.d.vibe.ts"),"empty-first suffixes change native TSX resolution")
      const init=spawnSync("jj",["git","init",dir],{encoding:"utf8"});assert.equal(init.status,0,init.stderr)
      const config=makeConfig({target:dir,test:"true",vibelangVersion:"0.0.11",install:"true"})
      config.packages=[{dir:".",sources:["src"],tsconfig:"tsconfig.json",dtsTsconfig:"tsconfig.json"}]
      await wireTarget(config,join(dir,".logs"))
      const after=parse()
      const check=(key,action)=>{try{action()}catch(error){issues.push({flag,inherited,key,message:error.message})}}
      if(group==="lint"){
        const written=JSON.parse(readFileSync(join(dir,"tsconfig.json"),"utf8"))
        check("modern severity policy",()=>assert.deepEqual(written.vibe.severities,cfg.vibe.severities))
        check("native plugin severity policy",()=>assert.deepEqual(after.options.plugins,before.options.plugins))
        check("authored exclusions",()=>assert.deepEqual(written.exclude,cfg.exclude))
      }
      if(group==="rewrite")check("effective authored rewrite option",()=>assert.equal(after.options.rewriteRelativeImportExtensions,before.options.rewriteRelativeImportExtensions))
      if(group==="suffix"){
        check("no moduleSuffixes",()=>assert.equal(after.options.moduleSuffixes,undefined))
        check("native target",()=>assert.equal(resolve(after.options),resolve(before.options)))
        check("unmigrated importer",()=>assert.equal(readFileSync(join(dir,"src/main.ts"),"utf8"),source))
      }
    }finally{rmSync(dir,{recursive:true,force:true})}
  }
  if(group==="suffix"){
    const docs=readFileSync(fileURLToPath(new URL("../../../.smithers/flows/migrate/README.md",import.meta.url)),"utf8")
    assert.match(docs,/extensionless/,"migration documents the extensionless limitation")
  }
  assert.deepEqual(issues,[],group+" setup contract")
}
