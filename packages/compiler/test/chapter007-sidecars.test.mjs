import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const repo=fileURLToPath(new URL("../../../",import.meta.url))
const binary=process.env.VIBELANG_BINARY||join(repo,"packages/compiler/native/vibelang")
const stock=join(repo,"docs/tools/node_modules/typescript/bin/tsc")
const options={target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",strict:true,types:[],declaration:true,jsx:"preserve",outDir:"out",rootDir:"src",skipLibCheck:true}
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),"chapter007-sidecars-"));t.after(()=>rmSync(root,{recursive:true,force:true}))
 mkdirSync(join(root,"node_modules"))
 symlinkSync(join(process.env.EFFECT_NODE_MODULES||join(repo,"experiments/node_modules"),"effect"),join(root,"node_modules/effect"))
 writeFileSync(join(root,"package.json"),'{"type":"module"}')
 return root
}
function write(root,name,text){mkdirSync(dirname(join(root,name)),{recursive:true});writeFileSync(join(root,name),text)}
function run(root,native=false){return spawnSync(native?process.execPath:binary,native?[stock,"-p",".","--pretty","false"] : ["-p",".","--pretty","false"],{cwd:root,encoding:"utf8",timeout:60000})}
// Chapter 007 / native sidecar input protection: docs/design/src/007-tooling.md#e0ac603662781e80
// Chapter 007 / native sidecar input protection: docs/design/src/007-tooling.md#ceb2de2a8fb7b544
// Chapter 007 / native sidecar input protection: docs/design/src/007-tooling.md#d1d183a2729d7cde
// Chapter 007 / native sidecar input protection: docs/design/src/007-tooling.md#092b5d73cecbc98c
// Chapter 007 / native sidecar input protection: docs/design/src/007-tooling.md#6ec3ab8356bc4fb4
// Chapter 007 / native sidecar input protection: docs/design/src/007-tooling.md#737ce4953909b6a1
// Chapter 007 / native sidecar input protection: docs/design/src/007-tooling.md#740ba781cfae6db6

for(const extension of ["vibe","vibex"])for(const directory of [false,true])for(const explicit of [false,true]){
 const sidecarTest=extension==="vibex"?test.todo:test
 sidecarTest("Chapter 007 / "+extension+" "+(directory?"mapped":"adjacent")+" "+(explicit?"explicit input":"discovered output"),t=>{
  const root=fixture(t), source="src/data."+extension, sidecar=(directory?".vibe/declarations/":"")+"src/data.d."+extension+".ts"
  const original="export declare const value: string; // must stay if input\n"
  write(root,source,"export const value = 42\n");write(root,sidecar,original)
  const config={compilerOptions:options,vibe:{effectGlobals:false,effectModules:false,...(directory?{sidecarDir:".vibe/declarations"}:{})},...(explicit?{files:[source,sidecar]}:{include:["src", ".vibe/declarations"]})}
  write(root,"tsconfig.json",JSON.stringify(config))
  const result=run(root)
  if(explicit){assert.equal(result.status,1,result.stdout+result.stderr);assert.match(result.stdout,/TS5055: Cannot write file/);assert.equal(readFileSync(join(root,sidecar),"utf8"),original)}
  else{assert.equal(result.status,0,result.stdout+result.stderr);assert.match(readFileSync(join(root,sidecar),"utf8"),/value = 42/)}
 })
}
// Native .ts/.d.ts discovery remains TypeScript's own, on both compiler paths.
// Chapter 007 / native TS resolution unchanged: docs/design/src/007-tooling.md#deba7e92d0b44f22

test("Chapter 007 / ordinary TypeScript source and declaration priority matches stock tsc",t=>{
 const outputs=[]
 for(const native of [true,false]){
  const root=fixture(t)
  write(root,"src/data.ts","export const value = 42\n")
  write(root,"src/data.d.ts","export declare const value: string\n")
  write(root,"src/main.ts",'import {value} from "./data.js"; const exact:42=value; export {exact}\n')
  write(root,"tsconfig.json",JSON.stringify({compilerOptions:options,include:["src"]}))
  const result=run(root,native)
  assert.equal(result.status,0,result.stdout+result.stderr)
  outputs.push(readFileSync(join(root,"out/main.d.ts"),"utf8"))
 }
 assert.equal(outputs[0],outputs[1])
})
