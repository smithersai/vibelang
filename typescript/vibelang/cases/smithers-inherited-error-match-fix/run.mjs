// run-seconds: 240
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
const here=path.dirname(fileURLToPath(import.meta.url))
const compiler=process.env.VIBELANG_BINARY || fileURLToPath(new URL("../../../built/local/tsc",import.meta.url))
const root=path.join(here,".cache","inherited-"+process.pid)
fs.mkdirSync(root,{recursive:true})
const run=(bin,args,cwd)=>{
 const r=spawnSync(bin,args,{cwd,encoding:"utf8",timeout:30000})
 assert.equal(r.error,undefined,r.error?.message)
 return {status:r.status,text:(r.stdout??"")+(r.stderr??"")}
}
for(const form of ["error","schema error"]) {
 for(const flags of [[]]) {
  const dir=path.join(root,form.replaceAll(" ","-")+"-"+flags.join("").replaceAll("-",""))
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir,"package.json"),'{"type":"module"}\n')
  const base=form==="error"
   ? 'class Base extends Data.TaggedError("Base" as string)<{ readonly id: string }> {}'
   : 'class Base extends Schema.TaggedError<Base>()("Base" as string, { id: Schema.String }) {}'
  const source='import { Data, Schema } from "effect"\n'+base+'\nexport '+form+' Child extends Base {}\n'+
   'export function label(value: Child | { readonly _tag: "Child"; readonly id: string }): string { return match(value) { when Child: value.id; } }\n'+
   'export function capture(value: Child | { readonly _tag: "Child"; readonly id: string }): string { return match(value) { when Child(let found): found.id; } }\n'
  fs.writeFileSync(path.join(dir,"main.vibe"),source)
  const config={compilerOptions:{target:"es2022",module:"nodenext",strict:true,skipLibCheck:true,types:[],declaration:true,noEmitOnError:false,outDir:"before"},include:["main.vibe"]}
  fs.writeFileSync(path.join(dir,"tsconfig.json"),JSON.stringify(config))
  const before=run(compiler,["-p",dir,"--pretty","false"],dir)
  assert.equal(before.status,2,before.text)
  assert.equal((before.text.match(/error EK2117:/g)??[]).length,1,before.text)
  assert.equal((before.text.match(/error (?:EK|TS)\d+:/g)??[]).length,1,before.text)
  const probe=async side=>{
   const m=await import(pathToFileURL(path.join(dir,side,"main.js")))
   const own=new m.Child({id:"own"}), foreign={_tag:"Child",id:"foreign"}
   return [m.label(own),m.label(foreign),m.capture(own),m.capture(foreign)]
  }
  const baseline=await probe("before")
  assert.deepEqual(baseline,["own","foreign","own","foreign"])
  const declaration=fs.readFileSync(path.join(dir,"before/main.d.ts"),"utf8")
  if(form==="error" && flags.length===0) {
   const twin='import { Data } from "effect"; import { $errorSubclass, $schemaErrorMatcher } from "vibelang-runtime";\n'+base+'\n'+
    'class Child extends $errorSubclass(Base,"Child") { declare readonly _tag:"Child"; static {$schemaErrorMatcher(this,"Child",true)} }\n'+
    'function label(value:Child|{readonly _tag:"Child";readonly id:string}):string {if(value._tag==="Child") return value.id; throw new TypeError()}\n'+
    'if(label(new Child({id:"own"}))!=="own" || label({_tag:"Child",id:"foreign"})!=="foreign") throw new Error("tag counterpart");\n'
   fs.writeFileSync(path.join(dir,"native.ts"),twin)
   fs.writeFileSync(path.join(dir,"tsconfig.native.json"),JSON.stringify({compilerOptions:{...config.compilerOptions,outDir:"native"},files:["native.ts"]}))
   const tsc=createRequire(import.meta.url).resolve("typescript/lib/tsc.js")
   const checked=run(process.execPath,[tsc,"-p","tsconfig.native.json","--pretty","false"],dir)
   assert.equal(checked.status,0,checked.text)
   const observed=run(process.execPath,["native/native.js"],dir)
   assert.equal(observed.status,0,observed.text)
  }
 }
}
fs.rmSync(root,{recursive:true})
console.log("inherited error matching retains extraction and declarations; TypeScript twin passes")
