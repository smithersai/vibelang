import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,existsSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"
import fc from "../../../docs/tools/node_modules/fast-check/lib/fast-check.js"
function project(action) {
 const dir=mkdtempSync(join(tmpdir(),"cov-tooling-extra-"))
 try{
  const put=(file,text)=>writeFileSync(join(dir,file),typeof text==="string"?text:JSON.stringify(text))
  mkdirSync(join(dir,"node_modules"));symlinkSync(join(process.env.EFFECT_NODE_MODULES,"effect"),join(dir,"node_modules/effect"));symlinkSync(process.env.VIBELANG_RUNTIME,join(dir,"node_modules/vibelang-runtime"))
  put("package.json",'{"type":"module"}')
  const options={strict:true,types:[],skipLibCheck:true,target:"ES2022",module:"NodeNext",outDir:"out",declaration:true}
  const config=files=>put("tsconfig.json",{compilerOptions:options,files,vibe:{effectGlobals:false,effectModules:false}})
  const invoke=(...args)=>{const r=spawnSync(process.env.VIBELANG_BINARY,args,{cwd:dir,encoding:"utf8",timeout:30000});assert.ifError(r.error);assert.equal(r.signal,null);return {...r,text:r.stdout+r.stderr}}
  return action({dir,put,options,config,invoke})
 }finally{rmSync(dir,{recursive:true,force:true})}
}
const methods={
 "migration-filter"(){
  project(({dir,put,options,config,invoke})=>{
   Object.assign(options,{noEmit:true})
   const source='import type {Effect} from "effect"; export type Run = Effect.Effect<number>;'
   put("main.vibe",source);config(["main.vibe"])
   const cfg=JSON.parse(readFileSync(join(dir,"tsconfig.json"),"utf8"));cfg.vibelang={diagnostics:{EK4609:"off"}};put("tsconfig.json",cfg)
   const r=invoke("--fix","--fix-migration-only","-p",".","--pretty","false");assert.equal(r.status,0,r.text)
   assert.equal(readFileSync(join(dir,"main.vibe"),"utf8"),source,"teaching/import rewrites must be excluded")
   const after=JSON.parse(readFileSync(join(dir,"tsconfig.json"),"utf8"));assert.equal(after.vibe.severities.EK4609,"off");assert.ok(!after.vibelang?.diagnostics)
  })
 },
 "foreign-refusal"(){
  project(({dir,put,options,config,invoke})=>{
   Object.assign(options,{noEmit:true})
   const foreign='/** @throws {never} */\nexport function invoke(f: () => number): number { return f() }'
   const source='import {Effect} from "effect"; import {invoke} from "./foreign.js"; export effect function main() { return invoke(() => try Effect.succeed(1)) }'
   put("foreign.ts",foreign);put("main.vibe",source);config(["main.vibe"])
   const before=invoke("-p",".","--pretty","false");assert.match(before.text,/error EK0501:/)
   const fixed=invoke("--fix","-p",".","--pretty","false")
   assert.equal(readFileSync(join(dir,"foreign.ts"),"utf8"),foreign,"foreign callback contract is outside the selected repair scope")
   assert.equal(readFileSync(join(dir,"main.vibe"),"utf8"),source,"a repair that needs the foreign contract must be refused")
   assert.match(fixed.text,/not fixed:|No quick fix:/i,"the refusal must explain the missing safe repair")
  })
 },

 "javascript-names"(){
  fc.assert(fc.property(fc.constantFrom("producer","file space","Unicodeé"),name=>project(({dir,put,options,config,invoke})=>{
   Object.assign(options,{rewriteRelativeImportExtensions:true})
   const source=ext=>'import {value} from '+JSON.stringify("./"+name+ext)+'; export const answer = value;'
   put(name+".vibe","export const value = 42;");put("main.vibe",source(".vibe"));config(["main.vibe"])
   const r=invoke("-p",".","--pretty","false");assert.equal(r.status,0,r.text)
   for(const file of ["main.js","main.d.ts",name+".js",name+".d.ts"])assert.ok(existsSync(join(dir,"out",file)),file)
   assert.ok(existsSync(join(dir,"main.d.vibe.ts")))
   put(name+".ts","export const value = 42;");put("main.ts",source(".ts"))
   const native=ts.createProgram([join(dir,"main.ts")],{...ts.convertCompilerOptionsFromJson(options,dir).options,outDir:join(dir,"stock")})
   assert.deepEqual(ts.getPreEmitDiagnostics(native).map(d=>d.code),[]);native.emit()
   const imports=file=>ts.createSourceFile(file,readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true).statements.filter(ts.isImportDeclaration).map(s=>new URL(s.moduleSpecifier.text,"file://"+file).href)
   assert.deepEqual(imports(join(dir,"out/main.js")),imports(join(dir,"stock/main.js")).map(s=>s.replace("/stock/","/out/")))
   const run=spawnSync(process.execPath,["--input-type=module","-e",'import {answer} from "./out/main.js"; console.log(answer)'],{cwd:dir,encoding:"utf8",timeout:15000})
   assert.equal(run.status,0,run.stderr);assert.equal(run.stdout.trim(),"42")
  })),{seed:34275,numRuns:8})
 },
 "native-recursion"(){
  for(const source of ['export const value = value;','export function recursive(n: number) { return n ? recursive(n-1) : 1 }','export const foo = [1].map(function () { return foo });']){
   project(({dir,put,options,config,invoke})=>{
    Object.assign(options,{noEmit:true});put("main.ts",source);config(["main.ts"])
    const native=ts.createProgram([join(dir,"main.ts")],ts.convertCompilerOptionsFromJson(options,dir).options)
    const expected=ts.getPreEmitDiagnostics(native).map(d=>d.code).sort()
    assert.ok(expected.some(c=>[7022,7023,7024].includes(c)))
    const r=invoke("-p",".","--pretty","false")
    assert.deepEqual([...r.text.matchAll(/error TS(\d+):/g)].map(m=>Number(m[1])).sort(),expected,r.text)
    assert.doesNotMatch(r.text,/EK\d+:/)
   })
  }
 },
 "catch-fix"(){
  project(({dir,put,options,config,invoke})=>{
   Object.assign(options,{noEmit:true})
   const source='import {Effect} from "effect"; export effect function main() { return Effect.fail("bad") catch (e) => Effect.succeed(7) }'
   put("main.vibe",source);config(["main.vibe"])
   const r=invoke("-p",".","--pretty","false");assert.equal(r.status,0,r.text);assert.match(r.text,/warning EK38\d+:.*catch/i)
   const fixed=invoke("--fix","-p",".","--pretty","false");assert.equal(fixed.status,0,fixed.text)
   assert.match(readFileSync(join(dir,"main.vibe"),"utf8"),/catch effect\s*\([^)]*\)\s*=>\s*try/)
  })
 },
 "extractor-fix"(){
  project(({dir,put,options,config,invoke})=>{
   Object.assign(options,{noEmit:true})
   put("main.vibe",'import * as Option from "effect/Option"; export function f(o: Option.Option<number>): number { return match(o) { when Option.Some(): 1; default: 0; } }');config(["main.vibe"])
   const r=invoke("-p",".","--pretty","false");assert.equal(r.status,0,r.text);assert.match(r.text,/warning EK0703:/)
   const fixed=invoke("--fix","-p",".","--pretty","false");assert.equal(fixed.status,0,fixed.text)
   const text=readFileSync(join(dir,"main.vibe"),"utf8");assert.match(text,/when Option.Some(?:\s*:|\(let [^)]+\)\s*:)/)
   const checked=invoke("-p",".","--pretty","false");assert.equal(checked.status,0,checked.text);assert.doesNotMatch(checked.text,/EK0703/)
  })
 },
 "unknown-foreign"(){
  project(({put,options,config,invoke})=>{
   Object.assign(options,{noEmit:true})
   put("foreign.ts",'export function opaque(s: string) { return s }')
   put("main.vibe",'import {opaque} from "./foreign.js"; export effect function run(s: string) { return opaque(s) }');config(["main.vibe"])
   const r=invoke("-p",".","--pretty","false");assert.notEqual(r.status,0,"unannotated foreign signature defaults to unknown in Effect code");assert.match(r.text,/error EK(?:0403|4401):/)
  })
 }
}
export function extraContract(mode){assert.ok(Object.hasOwn(methods,mode),mode);methods[mode]()}
