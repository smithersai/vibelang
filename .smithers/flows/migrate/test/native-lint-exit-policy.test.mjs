import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from "node:fs"
import {createRequire} from "node:module"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
import {test} from "node:test"
import {addEffectExitOptions} from "../lib/wire.mjs"

const root=fileURLToPath(new URL("../../../../",import.meta.url))
const require=createRequire(join(root,"packages/runtime/package.json"))
const ts=require("typescript")
const stock=require.resolve("typescript/bin/tsc")
const native=process.env.VIBELANG_BINARY || join(root,"packages/compiler/native/vibelang")
const effect=join(root,"experiments/node_modules/effect")

for(const authored of [undefined,false,true]) test("setup lint exit and emission with authored policy "+String(authored),()=>{
 const dir=mkdtempSync(join(tmpdir(),"native-lint-exit-"))
 try{
  mkdirSync(join(dir,"node_modules"))
  symlinkSync(effect,join(dir,"node_modules/effect"))
  writeFileSync(join(dir,"package.json"),'{"type":"module"}')
  writeFileSync(join(dir,"main.ts"),'import * as Effect from "effect/Effect"; Effect.succeed(1); export {}')
  const plugin={name:"@effect/language-service",diagnosticSeverity:{floatingEffect:"error"},...(authored===undefined?{}:{ignoreEffectWarningsInTscExitCode:authored,ignoreEffectErrorsInTscExitCode:authored})}
  const config={compilerOptions:{strict:true,skipLibCheck:true,types:[],target:"ES2022",module:"NodeNext",noEmitOnError:true,outDir:"out",plugins:[plugin]},files:["main.ts"]}
  const original=JSON.stringify(config)
  const run=(command,args)=>{
   const r=spawnSync(command,args,{cwd:dir,encoding:"utf8",timeout:30000})
   assert.equal(r.error,undefined)
   assert.equal(r.signal,null)
   return {...r,output:r.stdout+r.stderr}
  }
  writeFileSync(join(dir,"tsconfig.json"),original)
  const before=run(process.execPath,[stock,"-p","tsconfig.json","--pretty","false"])
  assert.equal(before.status,0,before.output)
  assert.ok(existsSync(join(dir,"out/main.js")))
  rmSync(join(dir,"out"),{recursive:true,force:true})
  if(authored===false){
   const clean=readFileSync(join(dir,"main.ts"),"utf8")
   writeFileSync(join(dir,"main.ts"),clean+"; const invalid: number = 'wrong';")
   const rejected=run(process.execPath,[stock,"-p","tsconfig.json","--pretty","false"])
   assert.match(rejected.output,/TS2322/)
   assert.equal(rejected.status,ts.ExitStatus.DiagnosticsPresent_OutputsSkipped,rejected.output)
   assert.equal(existsSync(join(dir,"out/main.js")),false)
   writeFileSync(join(dir,"main.ts"),clean)
  }
  const repaired=addEffectExitOptions(original,ts)
  const parsed=JSON.parse(repaired)
  assert.equal(parsed.compilerOptions.plugins[0].diagnosticSeverity.floatingEffect,"error")
  assert.equal(parsed.compilerOptions.plugins[0].ignoreEffectErrorsInTscExitCode,authored??true)
  assert.equal(addEffectExitOptions(repaired,ts),repaired)
  if(authored!==undefined) assert.equal(repaired,original)
  writeFileSync(join(dir,"tsconfig.json"),repaired)
  const after=run(native,["-p","tsconfig.json","--pretty","false"])
  assert.match(after.output,/error EK3801: floatingEffect:/)
  assert.equal(after.status,authored===false?ts.ExitStatus.DiagnosticsPresent_OutputsSkipped:ts.ExitStatus.Success,after.output)
  assert.equal(existsSync(join(dir,"out/main.js")),authored!==false,after.output)
  assert.equal(readFileSync(join(dir,"main.ts"),"utf8"),'import * as Effect from "effect/Effect"; Effect.succeed(1); export {}')
 }finally{rmSync(dir,{recursive:true,force:true})}
})
