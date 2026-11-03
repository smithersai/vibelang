import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync,symlinkSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname,join} from "node:path"
import {fileURLToPath} from "node:url"
import {test} from "node:test"
const repo=fileURLToPath(new URL("../../../",import.meta.url))
const binary=process.env.VIBELANG_BINARY||join(repo,"packages/compiler/native/vibelang")
const source='import {Effect} from "effect"\nexport type Run = Effect.Effect<number>\nexport const run=1\n'
const options={target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",strict:true,noEmit:true,allowImportingTsExtensions:true,types:[],skipLibCheck:true}
const write=(root,name,text)=>{mkdirSync(dirname(join(root,name)),{recursive:true});writeFileSync(join(root,name),text)}
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),"chapter007-fix-bounds-"));t.after(()=>rmSync(root,{recursive:true,force:true}))
 mkdirSync(join(root,"node_modules"));symlinkSync(join(process.env.EFFECT_NODE_MODULES||join(repo,"experiments/node_modules"),"effect"),join(root,"node_modules/effect"))
 write(root,"package.json",'{"type":"module"}')
 return root
}
function fix(root){return spawnSync(binary,["--fix","-p","tsconfig.json","--pretty","false"],{cwd:root,encoding:"utf8",timeout:120000})}
// Chapter 007 / project owned fix sources and entry point: docs/design/src/007-tooling.md#f402aaa0dce71fa7
// Chapter 007 / project owned fix sources and entry point: docs/design/src/007-tooling.md#1354a97f21ad96f6
// Chapter 007 / project owned fix sources and entry point: docs/design/src/007-tooling.md#a170ef60e665da22
// Chapter 007 / project owned fix sources and entry point: docs/design/src/007-tooling.md#fb10df5aecc188ad
test("Chapter 007 / fixes include owned imports omitted from discovery and keep foreign inputs",t=>{
 const root=fixture(t), untouched={}
 for(const name of ["foreign.ts","foreign.tsx","foreign.js","foreign.jsx","foreign.mjs","foreign.cjs","types.d.ts","stale.d.vibe.ts","stale.d.vibex.ts","state.tsbuildinfo","bun.lock","dist/generated.js"]){untouched[name]=name.endsWith(".ts")||name.endsWith(".tsx")?source:"// do not rewrite\n";write(root,name,untouched[name])}
 write(root,"src/own.vibe",source);write(root,"src/owned.vibex",source);write(root,"src/excluded.vibe",source)
 write(root,"src/main.vibe",'import {run} from "./excluded.vibe"; export const value=run\n')
 write(root,"tsconfig.json",JSON.stringify({compilerOptions:{...options,jsx:"preserve"},include:["src"],exclude:["src/excluded.vibe"],vibe:{effectGlobals:false,effectModules:false}}))
 const result=fix(root);assert.equal(result.status,0,result.stdout+result.stderr)
 assert.notEqual(readFileSync(join(root,"src/own.vibe"),"utf8"),source)
 assert.notEqual(readFileSync(join(root,"src/owned.vibex"),"utf8"),source)
 assert.notEqual(readFileSync(join(root,"src/excluded.vibe"),"utf8"),source)
 for(const [name,text] of Object.entries(untouched))assert.equal(readFileSync(join(root,name),"utf8"),text,name)
})
// Chapter 007 / config traversal remains inside the selected repository: docs/design/src/007-tooling.md#add337283d53127b
test.todo("Chapter 007 / legacy config migration does not edit a dependency extends file",t=>{
 const root=fixture(t)
 const legacy=JSON.stringify({compilerOptions:options,vibelang:{diagnostics:{EK4802:"off"}}})
 write(root,"node_modules/config-base/package.json",'{"name":"config-base","type":"module","exports":"./base.json"}')
 write(root,"node_modules/config-base/base.json",legacy)
 write(root,"tsconfig.json",JSON.stringify({extends:"./node_modules/config-base/base.json",files:["main.vibe"]}))
 write(root,"main.vibe","export const value=1\n")
 const result=fix(root);assert.equal(result.status,0,result.stdout+result.stderr)
 assert.equal(readFileSync(join(root,"node_modules/config-base/base.json"),"utf8"),legacy)
})
