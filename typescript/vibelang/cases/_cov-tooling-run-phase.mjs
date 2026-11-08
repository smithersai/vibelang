import assert from "node:assert/strict"
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from "node:fs"
import {spawnSync} from "node:child_process"
import {join} from "node:path"
import {tmpdir} from "node:os"

export function checkRunPhase(legacy=false) {
 if(!legacy)for(const value of ["Option.some(1)","Result.succeed(2)"]){
  const root=mkdtempSync(join(tmpdir(),"vip34-no-conversion-"))
  try{
   mkdirSync(join(root,"node_modules"))
   symlinkSync(join(process.env.EFFECT_NODE_MODULES,"effect"),join(root,"node_modules/effect"))
   symlinkSync(process.env.VIBELANG_RUNTIME,join(root,"node_modules/vibelang-runtime"))
   writeFileSync(join(root,"package.json"),'{"type":"module"}')
   writeFileSync(join(root,"main.vibe"),'import {Option,Result} from "effect"; export effect function main(){ return try '+value+' }')
   writeFileSync(join(root,"tsconfig.json"),JSON.stringify({compilerOptions:{strict:true,skipLibCheck:true,types:[],target:"ES2022",module:"NodeNext",noEmit:true},files:["main.vibe"],vibe:{effectGlobals:false,effectModules:false}}))
   const r=spawnSync(process.env.VIBELANG_BINARY,["-p",".","--pretty","false"],{cwd:root,encoding:"utf8",timeout:30000})
   assert.ifError(r.error);assert.equal(r.signal,null)
   assert.notEqual(r.status,0)
   assert.match(r.stdout+r.stderr,/error EK0502:/)
  }finally{rmSync(root,{recursive:true,force:true})}
 }
}
