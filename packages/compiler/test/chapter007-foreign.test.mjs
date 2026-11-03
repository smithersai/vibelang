import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdirSync,mkdtempSync,writeFileSync,rmSync,symlinkSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
import {test} from "node:test"
const repo=fileURLToPath(new URL("../../../",import.meta.url))
const binary=process.env.VIBELANG_BINARY||join(repo,"packages/compiler/native/vibelang")
// Chapter 007 / npm and local native call signatures share throws contracts: docs/design/src/007-tooling.md#e3561675cbf5674a
for(const location of ["local","npm"])for(const contract of ["unannotated","never","RangeError"])for(const bridge of [false,true]){
 const foreignTest=!bridge&&contract!=="never"?test.todo:test
 foreignTest("Chapter 007 / "+location+" "+contract+" "+(bridge?"wrapped":"direct")+" foreign call",t=>{
  const root=mkdtempSync(join(tmpdir(),"chapter007-foreign-"));t.after(()=>rmSync(root,{recursive:true,force:true}))
  mkdirSync(join(root,"node_modules"));symlinkSync(join(process.env.EFFECT_NODE_MODULES,"effect"),join(root,"node_modules/effect"))
  symlinkSync(join(repo,"packages/runtime"),join(root,"node_modules/vibelang-runtime"))
  writeFileSync(join(root,"package.json"),'{"type":"module"}')
  const comment=contract==="unannotated"?"":"/** @throws {"+contract+"} */\n"
  const specifier=location==="local"?"./foreign.js":"fixture"
  if(location==="local")writeFileSync(join(root,"foreign.ts"),comment+"export function read():number{return 1}\n")
  else{
   const dir=join(root,"node_modules/fixture");mkdirSync(dir)
   writeFileSync(join(dir,"package.json"),'{"name":"fixture","type":"module","exports":{".":{"types":"./index.d.ts","default":"./index.js"}}}')
   writeFileSync(join(dir,"index.d.ts"),comment+"export declare function read():number;\n")
   writeFileSync(join(dir,"index.js"),"export function read(){return 1}\n")
  }
  const source='import {Effect} from "effect";import {read} from '+JSON.stringify(specifier)+';export effect function probe(){return '+(bridge?"try Effect.try(()=>read())":"read()")+'}\n'
  writeFileSync(join(root,"main.vibe"),source)
  writeFileSync(join(root,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",strict:true,noEmit:true,types:[]},vibe:{effectGlobals:false,effectModules:false},files:["main.vibe"]}))
  const result=spawnSync(binary,["-p",".","--pretty","false"],{cwd:root,encoding:"utf8",timeout:60000})
  if(!bridge&&contract!=="never"){assert.notEqual(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/error EK0403:/)}
  else assert.equal(result.status,0,result.stdout+result.stderr)
 })
}
