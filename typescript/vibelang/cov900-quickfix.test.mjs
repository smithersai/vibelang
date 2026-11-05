// Chapter 900: real compiler CLI migration and diagnostic contracts.
import assert from "node:assert/strict"
import {test} from "node:test"
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync,cpSync,existsSync,symlinkSync} from "node:fs"
import {join} from "node:path"
import {fileURLToPath,pathToFileURL} from "node:url"
import {createRequire} from "node:module"
import {spawnSync} from "node:child_process"
const require=createRequire(new URL("../../packages/runtime/package.json",import.meta.url))
const fc=require("fast-check")
const base=fileURLToPath(new URL("../../experiments/",import.meta.url))
const runtime=fileURLToPath(new URL("../../packages/runtime/",import.meta.url))
const compiler=fileURLToPath(new URL("../built/local/tsc",import.meta.url))
function fixture(source,body,severities={EK4833:"off"}){
 const root=mkdtempSync(join(base,"cov900-fix-"))
 try {
  const modules=join(root,"node_modules")
  mkdirSync(modules)
  symlinkSync(join(process.env.EFFECT_NODE_MODULES,"effect"),join(modules,"effect"))
  const published=join(modules,"vibelang-runtime")
  mkdirSync(published)
  const manifest=JSON.parse(readFileSync(join(runtime,"package.json"),"utf8"))
  for(const file of ["package.json",...manifest.files])if(existsSync(join(runtime,file)))cpSync(join(runtime,file),join(published,file),{recursive:true,dereference:true})
  writeFileSync(join(root,"main.vibe"),source)
  writeFileSync(join(root,"package.json"),JSON.stringify({type:"module"}))
  writeFileSync(join(root,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"es2022",module:"nodenext",strict:true,skipLibCheck:true,types:[],lib:["esnext","dom"],outDir:"out"},vibe:{severities},files:["main.vibe"]}))
  const run=(...args)=>{
   const r=spawnSync(compiler,["--pretty","false","-p",join(root,"tsconfig.json"),...args],{encoding:"utf8",timeout:60000})
   assert.notEqual(r.status,null,JSON.stringify({error:r.error?.message,signal:r.signal}))
   return {status:r.status,text:r.stdout+r.stderr}
  }
  const observe=expression=>{
   const script="import * as M from "+JSON.stringify(pathToFileURL(join(root,"out/main.js")).href)+"; "+expression
   const r=spawnSync(process.execPath,["--input-type=module","-e",script],{cwd:root,encoding:"utf8",timeout:60000})
   assert.equal(r.status,0,r.stdout+r.stderr)
   return JSON.parse(r.stdout)
  }
  body({run,observe,source:()=>readFileSync(join(root,"main.vibe"),"utf8"),emit:()=>readFileSync(join(root,"out/main.js"),"utf8")})
 }finally{rmSync(root,{recursive:true,force:true})}
}

// docs/design/src/900-appendices.md#7e8e64f64b690629 — Chapter 900: trailing blocks preserve plain, Effect program, and Effect callback destinations.
test("trailing blocks preserve plain, Effect program, and Effect callback destinations",()=>{

 const prelude="service Users { static readonly key = \"cov900/Users\"; find(id: string): string!! }\nfunction test(name: string, body: () => Effect.Effect<number>) { return body() }\nfunction twice(f: () => number) { return f() + f() }\n"
 const variants=[
  ["export const live = Layer.effect(Users) { return { effect find(id: string) { return id } } }","export const live = Layer.effect(Users, effect { return { effect find(id: string) { return id } } })",true],
  ["export function f() { return Effect.scoped { const r = try Ref.make(1); return try Ref.get(r) } }","export function f() { return Effect.scoped(effect { const r = try Ref.make(1); return try Ref.get(r) }) }",true],
  ["export function f() { return test(\"one\") { const r = try Ref.make(1); return try Ref.get(r) } }","export function f() { return test(\"one\", effect () => { const r = try Ref.make(1); return try Ref.get(r) }) }",false],
  ["export function f() { return twice() { return 2 } }","export function f() { return twice(() => { return 2 }) }",false]
 ]
 for(const [before,after,sameEmit] of variants)fixture(prelude+before,({run,source,emit})=>{
  assert.match(run().text,/EK1101:/)
  const js=emit()
  const fixed=run("--fix")
  assert.equal(fixed.status,0,fixed.text)
  assert.equal(source(),prelude+after)
  const checked=run();assert.equal(checked.status,0,checked.text)
  if(sameEmit)assert.equal(emit(),js)
  run("--fix");assert.equal(source(),prelude+after)
 })

})

// docs/design/src/900-appendices.md#ed55030ff023734c — Chapter 900: EK4833 excludes interfaces extending Effect.
test("EK4833 excludes interfaces extending Effect",()=>{

 fixture('export interface Api<A> extends Effect.Effect<A, never, never> { readonly kind: "Api" }',({run})=>{
  const r=run();assert.equal(r.status,0,r.text);assert.doesNotMatch(r.text,/EK4833:/)
 })
 fixture("export type Api<A> = Effect.Effect<A, never, never>",({run})=>assert.match(run().text,/EK4833:/),{})

})

// docs/design/src/900-appendices.md#2cafa3662de1d89b — Chapter 900: omitted requirement migration preserves the inferred service.
test("omitted requirement migration preserves the inferred service",()=>{

 const before="service Input { static readonly key = \"cov900/Input\"; value: number }\nexport effect function read(): number!never { return (try Input).value }\n"
 fixture(before,({run,source})=>{
  assert.match(run().text,/EK4853:/)
  const fixed=run("--fix");assert.equal(fixed.status,0,fixed.text)
  assert.equal(source(),before.replace("number!never {","number!never!Input {"))
  const checked=run();assert.equal(checked.status,0,checked.text)
 })

})

// docs/design/src/900-appendices.md#eb178704b8cce0ba — Chapter 900: abstract service migration retains members.
test("abstract service migration retains members",()=>{

 const check=name=>fixture("export abstract class "+name+' { static readonly key = "cov900/'+name+'"; abstract name: string }\n',({run,source})=>{
  assert.match(run().text,/EK4854:/)
  const r=run("--fix");assert.equal(r.status,0,r.text)
  assert.equal(source(),"export service "+name+' { static readonly key = "cov900/'+name+'"; name: string }\n')
  assert.equal(run().status,0)
 })
 for(const name of ["Users","Accounts","Profile"])check(name)
 let generated=0
 fc.assert(fc.property(fc.integer({min:0,max:100000}),n=>{check("Service"+n);generated++}),{seed:9004854,numRuns:8})
 assert.equal(generated,8)
})

// VIP-9 and Chapter 007 require cached defaults to retain native service semantics.
const cachedDefaultMigrationRule = "Retain the original key, eager initialization, cached value identity, field and type reads, mutable shape members and missing-provider failure"

function checkCachedDefaultMigration(field="enabled",initial=true) {
 const spec=readFileSync(new URL("../../docs/design/vips/0009-service-declarations.md",import.meta.url),"utf8")
 assert.ok(spec.includes(cachedDefaultMigrationRule),"VIP-9 cached default preservation rule")
 const before="service Flags { static readonly key = \"vip9/Flags\"; static readonly default: Flags.Shape = { enabled: true }; enabled: boolean }\nexport type Value = typeof Flags.default\nexport type Indexed = (typeof Flags)[\"default\"]\nexport type Enabled = (typeof Flags.default)[\"enabled\"]\nexport type Deep = typeof Flags.default.enabled\nexport const value = Flags.default\nexport const element = Flags[\"default\"]\n"
 const after="import { Context as $legacyServiceContext } from \"effect\"\nimport { $global as $legacyServiceInit } from \"vibelang-runtime\"\nvoid $legacyServiceInit\nclass Flags extends $legacyServiceContext.Service<Flags, $legacyServiceContext.Service.Shape<typeof $legacyServiceShape>>()(\"vip9/Flags\") { static readonly default: $legacyServiceContext.Service.Shape<typeof $legacyServiceShape> = { enabled: true };\n}\nservice $legacyServiceShape {static readonly key = \"vip9/Flags/shape/$legacyServiceShape\";\n enabled: boolean\n}\n\nexport type Value = typeof Flags.default\nexport type Indexed = (typeof Flags)[\"default\"]\nexport type Enabled = (typeof Flags.default)[\"enabled\"]\nexport type Deep = typeof Flags.default.enabled\nexport const value = Flags.default\nexport const element = Flags[\"default\"]\n"
 const input=before.replaceAll("enabled",field).replace("= { "+field+": true }","= { "+field+": "+initial+" }")
 const expected=after.replaceAll("enabled",field).replace("= { "+field+": true }","= { "+field+": "+initial+" }")
 fixture(input,({run,source,observe})=>{
  const r=run();assert.equal((r.text.match(/EK4855:/g)||[]).length,1,r.text)
  const fixed=run("--fix");assert.equal(fixed.status,0,fixed.text)
  assert.equal(source(),expected)
  const checked=run();assert.equal(checked.status,0,checked.text)
  assert.deepEqual(observe("const same=M.value===M.element; const initial=M.value."+field+"; M.value."+field+"=!initial; console.log(JSON.stringify({same,initial,changed:M.element."+field+"}))"),{same:true,initial,changed:!initial})
  run("--fix");assert.equal(source(),expected)
 })
}

test("cached default migration retains value identity and type reads",()=>{
 checkCachedDefaultMigration()
})
test("cached default preservation covers field names and initial values",()=>{
 fc.assert(fc.property(fc.constantFrom("enabled","ready","active"),fc.boolean(),checkCachedDefaultMigration),{seed:9004855,numRuns:6})
})

// docs/design/src/900-appendices.md#f805da7f3c8a6844 — Chapter 900: Option.match advisory names the Option API.
test("Option.match advisory names the Option API",()=>{

 for(const [imp,ns] of [['import { Option } from "effect";',"Option"],['import * as O from "effect/Option";',"O"]]){
  fixture(imp+"\nexport const f=(v:"+ns+".Option<number>):number=>"+ns+".match(v,{onNone:():number=>0,onSome:(n):number=>n});",({run})=>{
   const r=run();assert.equal(r.status,0,r.text)
   assert.match(r.text,/EK4839:/)
   assert.ok(r.text.includes("Option.match chooses with Option's match API;"),r.text)
   assert.doesNotMatch(r.text,/Effect's Match/)
  })
 }

})
