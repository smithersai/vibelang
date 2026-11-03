// run-seconds: 720
// Chapter 007 / preserve eager static service values: docs/design/src/007-tooling.md#fab9665fd2f5e055
// Chapter 007 / preserve eager static service values: docs/design/src/007-tooling.md#b1dd29e36b7a08a6
import assert from "node:assert/strict"
import {mkdirSync,writeFileSync,readFileSync,symlinkSync,rmSync} from "node:fs"
import {spawnSync} from "node:child_process"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
import {createRequire} from "node:module"
const fc=createRequire(new URL("../../../../docs/tools/package.json",import.meta.url))("fast-check")
const repo=fileURLToPath(new URL("../../../../",import.meta.url)),root=fileURLToPath(new URL("./out/value-migration/",import.meta.url))
rmSync(root,{recursive:true,force:true})
const binary=process.env.VIBELANG_BINARY||join(repo,"packages/compiler/native/vibelang")
const failures=[]
const corpus=JSON.parse(readFileSync(new URL("../../../../packages/compiler/test/corpus/chapter007-service-value-identity.json",import.meta.url),"utf8"))
const keys=Object.keys(corpus.initializers)
function check(key,enabled=true){
 const dir=join(root,key+"-"+enabled);rmSync(dir,{recursive:true,force:true});mkdirSync(join(dir,"node_modules"),{recursive:true})
 symlinkSync(join(process.env.EFFECT_NODE_MODULES,"effect"),join(dir,"node_modules/effect"));symlinkSync(join(repo,"packages/runtime"),join(dir,"node_modules/vibelang-runtime"))
 writeFileSync(join(dir,"package.json"),'{"type":"module"}')
 const initializer=corpus.initializers[key].replace("enabled:true","enabled:"+enabled)
 const source='let made=0; let current={enabled:'+enabled+'}; const original=current;\nservice Flags { static readonly key="chapter007/Flags"; static readonly default:Flags.Shape='+initializer+'; enabled:boolean }\nconst first=Flags.default; current={enabled:false}; const second=Flags.default;\nexport const result={made,same:first===second,first:first.enabled,second:second.enabled,snapshot:second===original};\n'
 writeFileSync(join(dir,"main.vibe"),source)
 const config=outDir=>({compilerOptions:{target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",strict:true,types:[],outDir},files:["main.vibe"]})
 const compile=fix=>{
  writeFileSync(join(dir,"tsconfig.json"),JSON.stringify(config(fix?"after":"before")))
  const result=spawnSync(binary,["-p",".","--pretty","false",...(fix?["--fix"]:[])],{cwd:dir,encoding:"utf8",timeout:90000})
  assert.equal(result.status,0,result.stdout+result.stderr)
  return result
 }
 const observe=out=>{
  const result=spawnSync(process.execPath,["--input-type=module","-e",'import {result} from "./'+out+'/main.js";console.log(JSON.stringify(result))'],{cwd:dir,encoding:"utf8",timeout:30000})
  assert.equal(result.status,0,result.stdout+result.stderr);return JSON.parse(result.stdout)
 }
 compile(false);const before=observe("before")
 assert.equal(before.same,true);assert.equal(before.second,enabled);assert.equal(before.made,key==="eager-side-effect"?1:0)
 const fixed=compile(true),text=readFileSync(join(dir,"main.vibe"),"utf8")
 // Refusal is permitted when capture preservation cannot be proved.
 if(text===source){assert.match(fixed.stdout+fixed.stderr,/refus|cannot|unsafe|preserv/i);return}
 const after=observe("after")
 try{assert.deepEqual(after,before,key+": identity, eager side effects and mutable snapshot must survive --fix")}catch(error){return error.message}
}
for(const key of keys){const failure=check(key);if(failure)failures.push(failure)}
fc.assert(fc.property(fc.constantFrom(...keys),fc.boolean(),(key,enabled)=>{assert.equal(check(key,enabled),undefined)}),{seed:7007448,numRuns:6})
assert.deepEqual(failures,[])
console.log("ok")
