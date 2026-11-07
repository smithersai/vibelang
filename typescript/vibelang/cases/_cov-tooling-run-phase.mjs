import assert from "node:assert/strict"
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from "node:fs"
import {spawnSync} from "node:child_process"
import {join} from "node:path"
import {tmpdir} from "node:os"

// Each row is success data and, for a legacy wrapper, the body that gave it
// before VIP-1. A returned Effect value never ran there (D379), so Effect.void
// is the old wrapper's success data; return Effect.succeed(7) ran its call and
// succeeded with 7, so its try runs the same program and stays (ran-call).
export function checkRunPhase(legacy=false) {
 const data=[
  ["number",'7'],
  ["error",'new Missing({id:"x"})'],
  ["schema-error",'new Invalid({message:"bad"})'],
  ["effect",'Effect.succeed(7)','Effect.void'],
  ["conversion-member",'{asEffect(){return Effect.succeed(7)}}'],
  ...(legacy?[["ran-call",null,'Effect.succeed(7)']]:[])
 ]
 for(const [label,value,legacyValue=value] of data)for(const annotated of [false,true]){
  if(legacy&&annotated)continue
  for(const scope of legacy?["--fix-vip-only"]:["","--fix-migration-only"]){
   const root=mkdtempSync(join(tmpdir(),"vip34-run-phase-"))
   try{
    mkdirSync(join(root,"node_modules"))
    symlinkSync(join(process.env.EFFECT_NODE_MODULES,"effect"),join(root,"node_modules/effect"))
    symlinkSync(process.env.VIBELANG_RUNTIME,join(root,"node_modules/vibelang-runtime"))
    writeFileSync(join(root,"package.json"),'{"type":"module"}')
    const declarations='import {Effect} from "effect";\nerror Missing { id: string }\nschema error Invalid { message: string }\n'
    const body=legacy?legacyValue:"Effect.succeed("+value+")"
    const annotation=annotated?": Effect.Effect<unknown>":""
    const source=declarations+"export function make()"+annotation+" { return "+body+" }\nexport effect function main(){ return try make() }\n"
    writeFileSync(join(root,"main.vibe"),source)
    writeFileSync(join(root,"tsconfig.json"),JSON.stringify({compilerOptions:{strict:true,skipLibCheck:true,types:[],target:"ES2022",module:"NodeNext",noEmit:true},files:["main.vibe"],vibe:{effectGlobals:false,effectModules:false,severities:{EK3801:"off"}}}))
    const r=spawnSync(process.env.VIBELANG_BINARY,["--fix",...(scope?[scope]:[]),"-p",".","--pretty","false"],{cwd:root,encoding:"utf8",timeout:30000})
    assert.ifError(r.error);assert.equal(r.signal,null,label);assert.equal(r.status,0,label+": "+r.stdout+r.stderr)
    const after=readFileSync(join(root,"main.vibe"),"utf8")
    if(legacy&&label==="ran-call"){
     assert.match(after,/return try make\(\)/,label+": the old wrapper ran its returned call; its try runs the same program")
    }else if(legacy){
     // rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#1201c82921527c11 | **Amended 2026-11-01: migration preserves run phase.** The explicitly selected `--fix-vip-only` pass removes a known legacy wrapper's `try`, even when its success data is an error, a schema error, another Effect or an object with an `asEffect` member.
     assert.doesNotMatch(after,/return try make\(\)/,label+": known legacy wrapper returns success data; its try must be removed")
    }else{
     // rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#fa20a2c5ef7c6da6 | Ordinary `--fix` and `--fix-migration-only` never reinterpret a valid current `try` based on its final result type or lack of annotation.
     assert.match(after,/return try make\(\)/,label+": current Effect contract keeps intentional execution")
    }
   }finally{rmSync(root,{recursive:true,force:true})}
  }
 }
 if(!legacy)for(const value of ["Option.some(1)","Result.succeed(2)"]){
  const root=mkdtempSync(join(tmpdir(),"vip34-no-conversion-"))
  try{
   mkdirSync(join(root,"node_modules"))
   symlinkSync(join(process.env.EFFECT_NODE_MODULES,"effect"),join(root,"node_modules/effect"))
   symlinkSync(process.env.VIBELANG_RUNTIME,join(root,"node_modules/vibelang-runtime"))
   writeFileSync(join(root,"package.json"),'{"type":"module"}')
   writeFileSync(join(root,"main.vibe"),'import {Option,Result} from "effect"; export effect function main(){ return try '+value+' }')
   writeFileSync(join(root,"tsconfig.json"),JSON.stringify({compilerOptions:{strict:true,skipLibCheck:true,types:[],target:"ES2022",module:"NodeNext",noEmit:true},files:["main.vibe"],vibe:{effectGlobals:false,effectModules:false}}))
   const r=spawnSync(process.env.VIBELANG_BINARY,["--fix","-p",".","--pretty","false"],{cwd:root,encoding:"utf8",timeout:30000})
   assert.ifError(r.error);assert.equal(r.signal,null)
   assert.notEqual(r.status,0)
   assert.match(r.stdout+r.stderr,/error EK0502:/)
   const after=readFileSync(join(root,"main.vibe"),"utf8");assert.match(after,/return try /);assert.doesNotMatch(after,/\.asEffect\(/)
  }finally{rmSync(root,{recursive:true,force:true})}
 }
}
