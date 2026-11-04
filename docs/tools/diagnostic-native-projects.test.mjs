import assert from "node:assert/strict"
import {test} from "node:test"
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {probeExamples} from "./diagnostic-examples.mjs"
import {nativeProjectHost} from "./diagnostic-native-projects.mjs"

function fixture(run) {
 const temp=mkdtempSync(join(tmpdir(),"diagnostic-native-project-")),root=join(temp,"repository")
 const write=(name,text)=>{const file=join(root,name);mkdirSync(join(file,".."),{recursive:true});writeFileSync(file,text)}
 write("typescript/vibelang/cases/a/main.vibe",'import { value } from "../b/value.js"; export const result=value')
 write("typescript/vibelang/cases/a/tsconfig.json",'{}')
 write("typescript/vibelang/cases/a/package.json",JSON.stringify({dependencies:{"@scope/os":"file:stubs/os",realdep:"1"}}))
 write("typescript/vibelang/cases/a/stubs/os/package.json",'{"name":"@scope/os","version":"1"}')
 write("typescript/vibelang/cases/b/value.ts","export const value=1")
 write("packages/runtime/package.json",JSON.stringify({name:"vibelang-runtime",files:["dist"]}))
 write("packages/runtime/dist/index.d.ts","export const runtime: 1")
 write("experiments/node_modules/effect/package.json",'{"name":"effect","version":"4.1.1"}')
 write("experiments/node_modules/realdep/package.json",'{"name":"realdep","version":"1"}')
 const before={effect:process.env.EFFECT_NODE_MODULES,runtime:process.env.VIBELANG_RUNTIME}
 process.env.EFFECT_NODE_MODULES=join(root,"experiments/node_modules");process.env.VIBELANG_RUNTIME=join(root,"packages/runtime")
 try {run({root,base:join(temp,"host"),write})}
 finally {
  for(const [key,value] of [["EFFECT_NODE_MODULES",before.effect],["VIBELANG_RUNTIME",before.runtime]])if(value===undefined)delete process.env[key];else process.env[key]=value
  rmSync(temp,{recursive:true,force:true})
 }
}

test("native examples preserve sibling imports and local stubs without modifying source cases",()=>fixture(({root,base})=>{
 const source=join(root,"typescript/vibelang/cases/a"),host=nativeProjectHost(root,base),project=host.prepare(source)
 assert.equal(readFileSync(join(project,"../b/value.ts"),"utf8"),"export const value=1")
 assert.equal(realpathSync(join(project,"node_modules/@scope/os")),join(project,"stubs/os"))
 assert.equal(realpathSync(join(project,"node_modules/realdep")),join(root,"experiments/node_modules/realdep"))
 assert.equal(lstatSync(join(project,"node_modules/vibelang-runtime")).isSymbolicLink(),false)
 assert.equal(readFileSync(join(project,"node_modules/vibelang-runtime/dist/index.d.ts"),"utf8"),"export const runtime: 1")
 assert.equal(existsSync(join(source,"node_modules")),false)
 writeFileSync(join(project,"main.vibe"),"changed isolated input")
 assert.match(readFileSync(join(source,"main.vibe"),"utf8"),/import/)
}))

test("an absent declared peer is an invalid host, never evidence that a diagnostic is unreachable",()=>fixture(({root,base,write})=>{
 write("typescript/vibelang/cases/a/package.json",'{"dependencies":{"missing-peer":"1"}}')
 const host=nativeProjectHost(root,base)
 assert.throws(()=>host.prepare(join(root,"typescript/vibelang/cases/a")),/case dependency missing-peer is not installed/)
 assert.throws(()=>host.project(join(root,"outside")),/outside native cases/)
}))

test("an archive's private Effect peer cannot overwrite the pinned host package",()=>fixture(({root,base,write})=>{
 mkdirSync(base,{recursive:true});write(".cache/keep","")
 const compiler=join(base,"compiler.mjs")
 writeFileSync(compiler,`#!/usr/bin/env node
import {readFileSync} from 'node:fs';const peer=JSON.parse(readFileSync(process.cwd()+'/node_modules/effect/package.json','utf8'));if(peer.version!=='9.9.9')process.exit(3);console.log('main.vibe(1,1): error EK3201: private peer');process.exit(2)
`,{mode:0o755})
 const example={name:"private-peer",code:"EK3201",source:"export {}",files:{"main.vibe":"export {}","node_modules/effect/package.json":'{"name":"effect","version":"9.9.9"}'}}
 const result=probeExamples([example],new Map([["EK3201","error: a wrong version"]]),compiler,root)
 assert.deepEqual(result.findings,[])
 assert.equal(JSON.parse(readFileSync(join(root,"experiments/node_modules/effect/package.json"),"utf8")).version,"4.1.1")
}))
