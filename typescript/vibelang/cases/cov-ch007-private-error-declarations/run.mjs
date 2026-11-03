import {chapter007EffectTwinModules} from "../../test/chapter007-twin.mjs"
// run-seconds: 1260
// Chapter 007 / private error consumer declaration graph: docs/design/src/007-tooling.md#a698595e623894bd
// Chapter 007 / private error consumer declaration graph: docs/design/src/007-tooling.md#443b2df3b34b9785
// Chapter 007 / private error consumer declaration graph: docs/design/src/007-tooling.md#69d66e39cee1f587
// Chapter 007 / private error consumer declaration graph: docs/design/src/007-tooling.md#90e5d3c47d7d0b77
// Chapter 007 / private error consumer declaration graph: docs/design/src/007-tooling.md#69e955e514b21612
// Chapter 007 / private error consumer declaration graph: docs/design/src/007-tooling.md#f1b06cc613248afb
// Chapter 007 / private error consumer declaration graph: docs/design/src/007-tooling.md#230734a929d5c40a
import assert from "node:assert/strict"
import {mkdirSync,writeFileSync,readFileSync,symlinkSync,rmSync} from "node:fs"
import {spawnSync} from "node:child_process"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
const repo=fileURLToPath(new URL("../../../../",import.meta.url))
const root=fileURLToPath(new URL("./out/matrix/",import.meta.url))
rmSync(root,{recursive:true,force:true})
const stock=join(repo,"docs/tools/node_modules/typescript/bin/tsc")
const binary=process.env.VIBELANG_BINARY||join(repo,"packages/compiler/native/vibelang")
const graphs=[
 {key:"inferred-js",declaration:false,written:false,consumer:"none",codes:[]},
 {key:"inferred-main-dts",declaration:true,written:false,consumer:"none",codes:[4058]},
 {key:"inferred-consumer",declaration:true,written:false,consumer:"export",codes:[4023,4058]},
 {key:"written-main-dts",declaration:true,written:true,consumer:"none",codes:[]},
 {key:"written-consumer",declaration:true,written:true,consumer:"export",codes:[4023]},
 {key:"written-call-only",declaration:true,written:true,consumer:"call",codes:[]},
]
const twinModules=chapter007EffectTwinModules(root)
const javascript=new Map(),failures=[]
for(const native of [true,false])for(const graph of graphs){
 const dir=join(root,(native?"native":"vibe")+"-"+graph.key),extension=native?"ts":"vibe"
 mkdirSync(join(dir,"node_modules"),{recursive:true})
 writeFileSync(join(dir,"package.json"),'{"type":"module"}')
 const modules=native?twinModules:process.env.EFFECT_NODE_MODULES
 assert.ok(modules,"provide exact native Effect twin and current runtime dependencies")
 if(native)assert.equal(JSON.parse(readFileSync(join(modules,"effect/package.json"),"utf8")).version,"4.1.0")
 symlinkSync(join(modules,"effect"),join(dir,"node_modules/effect"))
 symlinkSync(join(repo,"packages/runtime"),join(dir,"node_modules/vibelang-runtime"))
 const helper=native?'import {Data,Effect} from "effect"; class BootError extends Data.TaggedError("BootError")<{message:string}>{}; export function load(){return Effect.gen(function*(){return yield* Effect.fail(new BootError({message:"boot"}))})}\n':'error BootError {message:string}\nexport effect function load(){throw new BootError({message:"boot"})}\n'
 const contract=graph.written?(native?": Effect.Effect<void,Effect.Error<ReturnType<typeof load>>,never>":": void!Effect.Error<ReturnType<typeof load>>"):""
 const main=native?'import {Effect} from "effect"; import {load} from "./helper.js"; export function main()'+contract+' {return Effect.gen(function*(){yield* load()})}\n':'import {Effect} from "effect"; import {load} from "./helper.vibe"; export effect function main()'+contract+' {try load()}\n'
 const evidence='type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false; type Expect<T extends true>=T; type SuccessProof=Expect<Equal<Effect.Success<ReturnType<typeof main>>,void>>; type ErrorProof=Expect<Equal<Effect.Error<ReturnType<typeof main>>,Effect.Error<ReturnType<typeof load>>>>; type ServicesProof=Expect<Equal<Effect.Services<ReturnType<typeof main>>,never>>;\n'
 const files=["helper."+extension,"entry."+extension]
 writeFileSync(join(dir,files[0]),helper);writeFileSync(join(dir,files[1]),main+evidence)
 if(graph.consumer!=="none"){
  files.push("consumer."+extension)
  writeFileSync(join(dir,files[2]),'import {main} from "./entry.'+(native?"js":"vibe")+'"; '+(graph.consumer==="export"?"export const program=main()":"main()")+"\n")
 }
 const options={target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",strict:true,types:[],declaration:graph.declaration,noEmitOnError:false,outDir:"dist"}
 writeFileSync(join(dir,"tsconfig.json"),JSON.stringify({compilerOptions:options,files,vibe:{effectGlobals:false,effectModules:false}}))
 const compiled=spawnSync(native?process.execPath:binary,native?[stock,"-p",".","--pretty","false"]:["-p",".","--pretty","false"],{cwd:dir,encoding:"utf8",timeout:90000})
 const output=compiled.stdout+compiled.stderr
 const codes=[...output.matchAll(/error (?:TS|EK)(\d+):/g)].map(m=>Number(m[1])).sort((a,b)=>a-b)
 try{assert.deepEqual(codes,graph.codes,(native?"native":"vibe")+" "+graph.key+": "+output)}catch(error){failures.push(error.message)}
 for(const file of ["helper.js","entry.js"]){
  const key=(native?"native":"vibe")+":"+file
  const text=readFileSync(join(dir,"dist",file),"utf8")
  if(javascript.has(key))assert.equal(text,javascript.get(key),"declaration and exact written contracts do not change executable bytes")
  else javascript.set(key,text)
 }
 if(graph.codes.length===0){
  const observed=spawnSync(process.execPath,["--input-type=module","-e",'import {Effect} from "effect"; import {main} from "./dist/entry.js"; console.log(JSON.stringify(await Effect.runPromiseExit(main())))'],{cwd:dir,encoding:"utf8",timeout:30000})
  assert.equal(observed.status,0,observed.stdout+observed.stderr)
  const exit=JSON.parse(observed.stdout);assert.equal(exit._tag,"Failure")
  const expectedKey="exit:"+graph.key
  if(native)javascript.set(expectedKey,exit)
  else assert.deepEqual(exit,javascript.get(expectedKey),"Exit agrees with exact pinned native counterpart")
 }
}
assert.deepEqual(failures,[])
console.log("ok")
