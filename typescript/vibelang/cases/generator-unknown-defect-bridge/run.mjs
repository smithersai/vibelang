// run-seconds: 150
import assert from "node:assert/strict"
import {mkdtempSync,readFileSync,writeFileSync,symlinkSync,rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname,join,resolve} from "node:path"
import {fileURLToPath} from "node:url"
import {spawnSync} from "node:child_process"
import {createRequire} from "node:module"
const here=dirname(fileURLToPath(import.meta.url)),compiler=resolve(here,"../../../built/local/tsc")
const require=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))
const stock=require.resolve("typescript/bin/tsc")
const dir=mkdtempSync(join(tmpdir(),"generator-unknown-defect-"))
function run(command,args,stage){
 const result=spawnSync(command,args,{encoding:"utf8",timeout:60000})
 assert.ifError(result.error);assert.equal(result.status,0,stage+"\n"+result.stdout+result.stderr);return result
}
try{
 symlinkSync(join(here,"node_modules"),join(dir,"node_modules"),"dir")
 for(const name of ["foreign.ts","tsconfig.json","package.json"])writeFileSync(join(dir,name),readFileSync(join(here,name)))
 writeFileSync(join(dir,"main.vibe"),readFileSync(join(here,"input.vibe.txt")))
 writeFileSync(join(dir,"stock.ts"),readFileSync(join(here,"input.vibe.txt"),"utf8").replace("effect function*","function*"))
 const config=JSON.parse(readFileSync(join(dir,"tsconfig.json"),"utf8"))
 writeFileSync(join(dir,"tsconfig.stock.json"),JSON.stringify({...config,compilerOptions:{...config.compilerOptions,outDir:"stock"},files:["stock.ts","foreign.ts"]}))
 run(process.execPath,[stock,"-p",join(dir,"tsconfig.stock.json"),"--pretty","false"],"stock TypeScript 5.9.3")
 run(compiler,["-p",dir,"--fix","--pretty","false"],"ordinary migration")
 const after=readFileSync(join(dir,"main.vibe"),"utf8");assert.match(after,/catch: \(e\) => e/);assert.match(after,/orDie/)
 writeFileSync(join(dir,"api.ts"),'import {work as actual} from "./out/main.js";import {work as expected} from "./stock/stock.js";const a:typeof actual=expected;const b:typeof expected=actual;type Equal<A,B>=(<T>()=>T extends A?1:2)extends(<T>()=>T extends B?1:2)?true:false;const equal:Equal<typeof actual,typeof expected>=true;')
 writeFileSync(join(dir,"tsconfig.api.json"),JSON.stringify({compilerOptions:{...config.compilerOptions,noEmit:true},files:["api.ts"]}))
 run(process.execPath,[stock,"-p",join(dir,"tsconfig.api.json"),"--pretty","false"],"native declaration equality")
 const observer=[
 'import assert from "node:assert/strict";import {Effect,Exit,Cause} from "effect";',
 'import * as a from "./out/main.js";import * as af from "./out/foreign.js";import * as b from "./stock/stock.js";import * as bf from "./stock/foreign.js";',
 'function observe(module,foreign,input){foreign.events.length=0;const program=module.work(input);assert.equal(foreign.events.length,0);const exit=Effect.runSyncExit(program);return {events:foreign.events.slice(),value:Exit.isSuccess(exit)?exit.value:null,reasons:Exit.isFailure(exit)?exit.cause.reasons.map(r=>({tag:r._tag,value:r._tag==="Die"?(r.defect instanceof Error?{name:r.defect.name,message:r.defect.message}:r.defect===foreign.marker?"same-marker":r.defect):"typed"})):[]}}',
 'for(const input of [undefined,"","ok","primitive","object","error"])assert.deepEqual(observe(a,af,input),observe(b,bf,input));'
 ].join("\n")
 writeFileSync(join(dir,"observe.mjs"),observer);run(process.execPath,[join(dir,"observe.mjs")],"coldness and native Exit identity")
 run(compiler,["-p",dir,"--fix","--noEmit","--pretty","false"],"idempotence");assert.equal(readFileSync(join(dir,"main.vibe"),"utf8"),after)
}finally{rmSync(dir,{recursive:true,force:true})}
console.log("generator migration preserves native defects")
