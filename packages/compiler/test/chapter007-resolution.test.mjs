import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdirSync,mkdtempSync,writeFileSync,rmSync,symlinkSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
import {test} from "node:test"
const repo=fileURLToPath(new URL("../../../",import.meta.url))
const binary=process.env.VIBELANG_BINARY||join(repo,"packages/compiler/native/vibelang")
const stock=join(repo,"docs/tools/node_modules/typescript/bin/tsc")
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),"chapter007-resolution-"));t.after(()=>rmSync(root,{recursive:true,force:true}))
 mkdirSync(join(root,"node_modules"));symlinkSync(join(process.env.EFFECT_NODE_MODULES||join(repo,"experiments/node_modules"),"effect"),join(root,"node_modules/effect"));writeFileSync(join(root,"package.json"),'{"type":"module"}');return root
}
const options={target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",strict:true,types:[],noEmit:true,allowImportingTsExtensions:true,rewriteRelativeImportExtensions:true}
const run=(root,native=false)=>spawnSync(native?process.execPath:binary,native?[stock,"-p",".","--pretty","false"]:["-p",".","--pretty","false"],{cwd:root,encoding:"utf8",timeout:60000})
// Chapter 007 / native tsconfig extension rules: docs/design/src/007-tooling.md#bd9fa76a574e3535
// Chapter 007 / native tsconfig extension rules: docs/design/src/007-tooling.md#0f6c4e93cb5e04ff
// Chapter 007 / native tsconfig extension rules: docs/design/src/007-tooling.md#0349f5f6e8a6c56f
test("Chapter 007 / NodeNext JavaScript imports find Vibe sources and extensionless imports need extensions",t=>{
 for(const native of [true,false])for(const extensionless of [true,false]){
  const root=fixture(t),ext=native?"ts":"vibe"
  writeFileSync(join(root,"user."+ext),"export const Factory=42\n")
  writeFileSync(join(root,"main."+ext),'import {Factory} from "./user'+(extensionless?"":".js")+'"; export const exact:42=Factory\n')
  writeFileSync(join(root,"tsconfig.json"),JSON.stringify({compilerOptions:options,files:["main."+ext],vibe:{effectGlobals:false,effectModules:false}}))
  const result=run(root,native)
  if(extensionless){assert.notEqual(result.status,0);assert.match(result.stdout,/TS283[45]:/)}
  else assert.equal(result.status,0,result.stdout+result.stderr)
 }
})
// Chapter 007 / retired stale written TS fallback: docs/design/src/007-tooling.md#ae713e25a3d7e73b
// Chapter 007 / retired stale written TS fallback: docs/design/src/007-tooling.md#9b22f60d40467052
// Chapter 007 / retired stale written TS fallback: docs/design/src/007-tooling.md#6254a3da6694d57f
// Chapter 007 / retired stale written TS fallback: docs/design/src/007-tooling.md#04f8beffe186a474
test.todo("Chapter 007 / a stale written .ts path never silently selects .vibe",t=>{
 for(const native of [true,false]){
  const root=fixture(t),ext=native?"ts":"vibe"
  writeFileSync(join(root,"gone.vibe"),"export const Stale=1\n")
  writeFileSync(join(root,"main."+ext),'import {Stale} from "./gone.ts"; export const value=Stale\n')
  writeFileSync(join(root,"tsconfig.json"),JSON.stringify({compilerOptions:options,files:["main."+ext],vibe:{effectGlobals:false,effectModules:false}}))
  const result=run(root,native)
  assert.notEqual(result.status,0,(native?"native":"vibe")+": stale written TS path must fail: "+result.stdout+result.stderr)
  assert.match(result.stdout,/TS2307: Cannot find module '\.\/gone\.ts'/)
 }
})
