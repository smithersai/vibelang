import {chapter007EffectTwinModules} from "../../../typescript/vibelang/test/chapter007-twin.mjs"
import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync,symlinkSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
import {createRequire} from "node:module"
import {test} from "node:test"
const repo=fileURLToPath(new URL("../../../",import.meta.url))
const binary=process.env.VIBELANG_BINARY||join(repo,"packages/compiler/native/vibelang")
const fc=createRequire(new URL("../../../docs/tools/package.json",import.meta.url))("fast-check")
// Chapter 007 / legacy fork scope order and delayed thunk preservation: docs/design/src/007-tooling.md#528e01beeac201e6
// Chapter 007 / legacy fork scope order and delayed thunk preservation: docs/design/src/007-tooling.md#66ff95d1b2557541
// Chapter 007 / actual program-then-scope forkIn API and native channels: docs/design/src/007-tooling.md#64291f947aa6060d
test("Chapter 007 / legacy scope-first fork thunks preserve receiver, phase and cleanup",t=>{
 const root=mkdtempSync(join(tmpdir(),"chapter007-fork-migration-"));t.after(()=>rmSync(root,{recursive:true,force:true}))
 const prefix='import {Effect,Fiber,Scope,Exit} from "effect";let trace:string[]=[];function scopeArg(scope:Scope.Scope){trace.push("scope");return scope} const receiver={calls:0,work(){this.calls++;trace.push("work");return Effect.succeed(this.calls).pipe(Effect.ensuring(Effect.sync(()=>{trace.push("cleanup")})))}};\n'
 const before='trace=[];receiver.calls=0;const scope=EXEC Scope.make();'
 const after='trace.push("held");const fiber=EXEC program;const value=EXEC Fiber.join(fiber);EXEC Scope.close(scope,Exit.void);return {value,calls:receiver.calls,trace};'
 const types='type Equal<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false; const success:Equal<Effect.Success<ReturnType<typeof probe>>,{value:number;calls:number;trace:string[]}>=true; const failure:Equal<Effect.Error<ReturnType<typeof probe>>,never>=true; const services:Equal<Effect.Services<ReturnType<typeof probe>>,never>=true;\n'
 const nativeSource=prefix+'export function probe(){return Effect.gen(function*(){'+before.replaceAll("EXEC","yield*")+'const bound=scopeArg(scope);const program=Effect.forkIn(Effect.suspend(()=>receiver.work()),bound);'+after.replaceAll("EXEC","yield*")+'})}\n'
 function check(native,comment,current=false){
  const dir=join(root,native?"native":current?"current":"vibe"+comment.length);rmSync(dir,{recursive:true,force:true});mkdirSync(join(dir,"node_modules"),{recursive:true})
  const modules=native?chapter007EffectTwinModules(root):(process.env.EFFECT_NODE_MODULES||join(repo,"experiments/node_modules"))
  if(native)assert.equal(JSON.parse(readFileSync(join(modules,"effect/package.json"),"utf8")).version,"4.1.0")
  symlinkSync(join(modules,"effect"),join(dir,"node_modules/effect"));symlinkSync(join(repo,"packages/runtime"),join(dir,"node_modules/vibelang-runtime"));writeFileSync(join(dir,"package.json"),'{"type":"module"}')
  const file=native?"main.ts":"main.vibe"
  const source=(native?nativeSource:prefix+'export effect function probe(){'+before.replaceAll("EXEC","try")+(current?'const bound=scopeArg(scope);const program=Effect.forkIn(Effect.suspend(()=>receiver.work()),bound);':'const program=forkIn('+comment+'scopeArg(scope),()=>receiver.work());')+after.replaceAll("EXEC","try")+'}\n')+types
  writeFileSync(join(dir,file),source)
  writeFileSync(join(dir,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",strict:true,types:[],outDir:"dist"},files:[file],vibe:{effectGlobals:false,effectModules:false}}))
  const result=spawnSync(native?process.execPath:binary,native?[join(repo,"docs/tools/node_modules/typescript/bin/tsc"),"-p",".","--pretty","false"]:[...(current?[]:["--fix","--fix-vip-only"]),"-p",".","--pretty","false"],{cwd:dir,encoding:"utf8",timeout:120000})
  if(!native&&result.status!==0&&readFileSync(join(dir,file),"utf8")===source&&/try not written:.*(?:unknown|inferred|would add)|cannot preserve|could not prove/i.test(result.stdout+result.stderr))return {refused:true}
  assert.equal(result.status,0,result.stdout+result.stderr)
  const ran=spawnSync(process.execPath,["--input-type=module","-e",'import {Effect} from "effect";import {probe} from "./dist/main.js";const xs=[];for(let i=0;i<2;i++)xs.push(await Effect.runPromiseExit(probe()));console.log(JSON.stringify(xs))'],{cwd:dir,encoding:"utf8",timeout:30000})
  assert.equal(ran.status,0,ran.stdout+ran.stderr)
  return JSON.parse(ran.stdout)
 }
 const expected=check(true,"")
 assert.deepEqual(check(false,"",true),expected)
 for(const exit of expected){assert.equal(exit._tag,"Success");assert.deepEqual(exit.value,{value:1,calls:1,trace:["scope","held","work","cleanup"]})}
 fc.assert(fc.property(fc.constantFrom(...JSON.parse(readFileSync(new URL("./corpus/foldkit-legacy-fork-thunk.json",import.meta.url),"utf8")).comments),comment=>{const actual=check(false,comment);if(!actual.refused)assert.deepEqual(actual,expected)}),{seed:7007423,numRuns:2})
})
