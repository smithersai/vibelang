import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync,symlinkSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
import {test} from "node:test"
const repo=fileURLToPath(new URL("../../../",import.meta.url))
const binary=process.env.VIBELANG_BINARY||join(repo,"packages/compiler/native/vibelang")
// Chapter 007 / build fixes owned sources in project dependency order: docs/design/src/007-tooling.md#a1beb9c6c673c47b
test.todo("Chapter 007 / --fix -b handles each referenced project's owned sources in build order",t=>{
 const root=mkdtempSync(join(tmpdir(),"chapter007-build-fix-"));t.after(()=>rmSync(root,{recursive:true,force:true}))
 mkdirSync(join(root,"node_modules"));symlinkSync(join(process.env.EFFECT_NODE_MODULES||join(repo,"experiments/node_modules"),"effect"),join(root,"node_modules/effect"))
 writeFileSync(join(root,"package.json"),'{"type":"module"}')
 const source='import {Effect} from "effect";export type Run=Effect.Effect<number>;\n'
 for(const name of ["lib","app"]){
  mkdirSync(join(root,name))
  writeFileSync(join(root,name,"own.vibe"),source)
  writeFileSync(join(root,name,"foreign.ts"),source)
  writeFileSync(join(root,name,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",composite:true,rootDir:".",outDir:"dist",strict:true,types:[]},files:["own.vibe","foreign.ts"],...(name==="app"?{references:[{path:"../lib"}]}:{})}))
 }
 writeFileSync(join(root,"tsconfig.json"),JSON.stringify({files:[],references:[{path:"app"}]}))
 const result=spawnSync(binary,["--fix","-b","tsconfig.json","--pretty","false"],{cwd:root,encoding:"utf8",timeout:120000})
 assert.equal(result.status,0,result.stdout+result.stderr)
 for(const name of ["lib","app"]){
  assert.notEqual(readFileSync(join(root,name,"own.vibe"),"utf8"),source)
  assert.equal(readFileSync(join(root,name,"foreign.ts"),"utf8"),source)
 }
 const lib=result.stdout.indexOf("lib/own.vibe"),app=result.stdout.indexOf("app/own.vibe")
 assert.ok(lib>=0&&app>lib,result.stdout)
})
