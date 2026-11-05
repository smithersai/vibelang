import assert from "node:assert/strict"
import {test} from "node:test"
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {probeExamples} from "./diagnostic-examples.mjs"
import {nativeProjectHost} from "./diagnostic-native-projects.mjs"

async function fixture(run) {
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
 try {await run({root,base:join(temp,"host"),write})}
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

test("an archive's private Effect peer cannot overwrite the pinned host package",()=>fixture(async ({root,base,write})=>{
 mkdirSync(base,{recursive:true});write(".cache/keep","")
 const compiler=join(base,"compiler.mjs")
 writeFileSync(compiler,`#!/usr/bin/env node
import {readFileSync} from 'node:fs';const peer=JSON.parse(readFileSync(process.cwd()+'/node_modules/effect/package.json','utf8'));if(peer.version!=='9.9.9')process.exit(3);console.log('main.vibe(1,1): error EK3201: private peer');process.exit(2)
`,{mode:0o755})
 const example={name:"private-peer",code:"EK3201",source:"export {}",files:{"main.vibe":"export {}","node_modules/effect/package.json":'{"name":"effect","version":"9.9.9"}'}}
 const result=await probeExamples([example],new Map([["EK3201","error: a wrong version"]]),compiler,root)
 assert.deepEqual(result.findings,[])
 assert.equal(JSON.parse(readFileSync(join(root,"experiments/node_modules/effect/package.json"),"utf8")).version,"4.1.1")
}))

function compilerFixture(base, script) {
 mkdirSync(base,{recursive:true})
 const compiler=join(base,"compiler.mjs"),events=join(base,"events.jsonl")
 writeFileSync(compiler,'#!/usr/bin/env node\nimport {appendFileSync,existsSync,readFileSync} from "node:fs";\n'+
  'const events='+JSON.stringify(events)+',dir=process.cwd();\n'+
  'const log=event=>appendFileSync(events,JSON.stringify({event,dir,pid:process.pid,exists:existsSync(dir)})+"\\n");\n'+script,
  {mode:0o755})
 return {compiler,events:()=>readFileSync(events,"utf8").trim().split("\n").map(line=>JSON.parse(line))}
}
const delayedCompiler='log("start");setTimeout(()=>{log("done");console.log("main.vibe(1,1): error EK2301: pipe body has no topic");process.exit(2)},200)'
const probeAppendix=new Map([["EK2301","error: pipe body has no topic"]])

test("Appendix replay bounds concurrent compilers and checks every independent example in input order",()=>fixture(async ({root,base,write})=>{
 write(".cache/keep","")
 const host=compilerFixture(base,delayedCompiler)
 const examples=Array.from({length:9},(_,i)=>({name:"pipe-"+i,code:"EK2301",source:"export const value = "+i+" |> 2",...(i%3===0?{control:true}:{})}))
 const result=await probeExamples(examples,probeAppendix,host.compiler,root)
 assert.deepEqual(result.findings.map(f=>f.name),["pipe-0","pipe-3","pipe-6"])
 assert.ok(result.findings.every(f=>f.kind==="example-code-mismatch"))
 assert.deepEqual(result.receipts.map(r=>r.name),examples.map(e=>e.name))
 let active=0,maximum=0
 for(const event of host.events()){active+=event.event==="start"?1:-1;maximum=Math.max(maximum,active)}
 assert.equal(active,0)
 assert.ok(maximum>1,"independent examples must overlap rather than exhaust the gate serially")
 assert.ok(maximum<=4,"the replay must respect its four-compiler budget")
 assert.equal(host.events().length,examples.length*2)
}))

test("Appendix replay serializes witnesses sharing a native project",()=>fixture(async ({root,base,write})=>{
 write(".cache/keep","")
 const host=compilerFixture(base,delayedCompiler)
 const examples=Array.from({length:5},(_,i)=>({name:"native-pipe-"+i,code:"EK2301",source:"export {}",project:join(root,"typescript/vibelang/cases/a")}))
 const result=await probeExamples(examples,probeAppendix,host.compiler,root)
 assert.deepEqual(result.findings,[])
 let active=0
 for(const event of host.events()){active+=event.event==="start"?1:-1;assert.ok(active<=1,"native sidecars cannot race within one project")}
 assert.equal(host.events().length,examples.length*2)
 assert.equal(result.receipts.length,examples.length)
}))

test("Appendix replay waits for active compilers before cleaning up after a failed compiler",()=>fixture(async ({root,base,write})=>{
 write(".cache/keep","")
 const host=compilerFixture(base,'log("start");const fail=readFileSync("main.vibe","utf8")==="crash";setTimeout(()=>{log("done");if(!fail)console.log("main.vibe(1,1): error EK2301: pipe body has no topic");process.exit(fail?3:2)},fail?50:300)')
 const examples=["crash","slow"].map(name=>({name,code:"EK2301",source:name}))
 await assert.rejects(async()=>await probeExamples(examples,probeAppendix,host.compiler,root),/failed without located source diagnostics/)
 const events=host.events()
 assert.equal(events.length,4)
 assert.ok(events.every(event=>event.exists),"cleanup must wait for every running compiler")
 assert.equal(existsSync(join(root,"packages/runtime/node_modules/effect")),false)
}))
