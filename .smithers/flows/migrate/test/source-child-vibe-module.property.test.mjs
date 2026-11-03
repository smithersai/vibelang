import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { addSourceChildLoaders } from "../lib/source-children.mjs"
import { prepareState, applyState } from "../lib/codemod-state.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const require = createRequire(join(repo, "packages/runtime/package.json"))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-source-child-vibe-module.json", import.meta.url)))
const rule = "A body is a TypeScript file stored inside a "+String.fromCharCode(96)+".vibe"+String.fromCharCode(96)+" file."
function fixture({ suffix="", runtime="node" }={}) {
  const root=mkdtempSync(join(tmpdir(),"alchemy child module #-"))
  const put=(file,text)=>{mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),text)}
  put("package.json",JSON.stringify({type:"module",exports:corpus.exports}))
  const original=corpus.source.replace('"node"',JSON.stringify(runtime))+suffix
  const wired=addSourceChildLoaders(original,ts,{file:corpus.file}).text
  assert.match(wired,/VibeLang source-child loader arguments/)
  put(corpus.file,wired)
  mkdirSync(join(root,"node_modules"))
  symlinkSync(join(repo,"packages/runtime/node_modules/typescript"),join(root,"node_modules/typescript"),"dir")
  const plan=()=>prepareState(root,[corpus.file],[corpus.file],{ts,tracked:[corpus.file,"package.json"]})
  const result=state=>state.writes.find(w=>w.file==="src/Trace.vibe")?.after ?? readFileSync(join(root,corpus.file),"utf8")
  return {root,put,wired,plan,result,dispose:()=>rmSync(root,{recursive:true,force:true})}
}
test("source-child module conversion follows VIP-40's TypeScript-file rule",()=>{
  assert.ok(readFileSync(new URL("../../../../docs/design/vips/0040-module-declarations.md",import.meta.url),"utf8").includes(rule))
})
test("Alchemy's published wildcard keeps a private inline helper that compiles as Vibe",()=>{
  const f=fixture()
  try{
    const state=f.plan(), text=f.result(state)
    assert.match(text,/module __vibelangSourceChildPlatform\d* \{/)
    assert.ok(!text.includes("import.meta.resolve"))
    assert.match(text,/undefined, import\.meta\.url/)
    assert.ok(!state.writes.some(w=>w.file.endsWith(".platform.ts")))
    assert.equal(state.sourceChildModules.converted.length,1)
    assert.ok(!existsSync(join(f.root,"src/Trace.vibe")),"preparation is read-only")
    assert.equal(readFileSync(join(f.root,corpus.file),"utf8"),f.wired)
    applyState(f.root,state)
    const first=readFileSync(join(f.root,"src/Trace.vibe"),"utf8")
    applyState(f.root,state)
    assert.equal(readFileSync(join(f.root,"src/Trace.vibe"),"utf8"),first,"journal replay is idempotent")
  }finally{f.dispose()}
})
test("property: generated names, source runtime and shadowed local spellings keep the private boundary",()=>{
  fc.assert(fc.property(fc.integer({min:0,max:8}),fc.constantFrom("node","bun"),fc.boolean(),(count,runtime,shadow)=>{
    const suffix="\n"+Array.from({length:count},(_,i)=>"const __vibelangSourceChildPlatform"+(i?i+1:"")+" = "+i+";").join("\n")+
      (shadow?'\nfunction unused(__vibelangNodeURL: number) { return __vibelangNodeURL }\n':"")
    const f=fixture({suffix,runtime})
    try{
      const state=f.plan(), text=f.result(state)
      assert.match(text,/module __vibelangSourceChildPlatform\d* \{/)
      assert.ok(!text.includes("import.meta.resolve"))
      assert.ok(text.includes(suffix.trim())||!suffix.trim())
      assert.equal(state.sourceChildModules.converted.length,1)
      assert.ok(!state.writes.some(w=>w.file.endsWith(".platform.ts")))
    }finally{f.dispose()}
  }),{seed:561173,numRuns:48})
})
test("a trailing comma in an owned call remains valid",()=>{
 const f=fixture()
 try{
  f.put(corpus.file,f.wired.replace('["./worker.ts"])','["./worker.ts"],)'))
  const state=f.plan(),text=f.result(state)
  assert.match(text,/\["\.\/worker\.ts"\], undefined, import\.meta\.url,/)
  assert.equal(state.sourceChildModules.converted.length,1)
 }finally{f.dispose()}
})
test("manually observed or edited helpers are retained with a located refusal",()=>{
 for(const mutate of [s=>s+'\nexport { __vibelangSourceChild }\n',s=>s+'\nconsole.log(...__vibelangSourceChild("node", []))\n',s=>s.replace('const valueFlags =','const edited = 1;\n  const valueFlags =')]){
  const f=fixture()
  try{
   const changed=mutate(f.wired);f.put(corpus.file,changed)
   const state=f.plan()
   assert.equal(f.result(state),changed)
   assert.ok(state.sourceChildModules.refused.some(r=>r.file===corpus.file&&r.line>0))
  }finally{f.dispose()}
 }
})
for(const childRuntime of ["node","bun"])test("native: "+childRuntime+" helpers have identical declarations and loader arguments",()=>{
 const compiler=process.env.VIBELANG_BINARY??join(repo,"packages/compiler/native/vibelang")
 assert.ok(existsSync(compiler),"build or provide the native compiler")
 const f=fixture({runtime:childRuntime})
 try{
  const runtime=join(repo,"packages/runtime")
  f.put("tsconfig.json",JSON.stringify({compilerOptions:{target:"esnext",module:"esnext",moduleResolution:"bundler",strict:true,declaration:true,skipLibCheck:true,types:["node"],rootDir:"src",outDir:"out"},include:["src/Trace.*"]}))
  mkdirSync(join(f.root,"node_modules"),{recursive:true})
  symlinkSync(join(runtime,"node_modules/effect"),join(f.root,"node_modules/effect"),"dir")
  symlinkSync(join(runtime,"node_modules/@types"),join(f.root,"node_modules/@types"),"dir")
  symlinkSync(runtime,join(f.root,"node_modules/vibelang-runtime"),"dir")
  f.put("node_modules/vibelang/package.json",JSON.stringify({type:"module",exports:{"./register":"./register.mjs","./bun":"./bun.mjs"}}))
  f.put("node_modules/vibelang/register.mjs","export {}\n");f.put("node_modules/vibelang/bun.mjs","export {}\n")
  const native=()=>spawnSync(compiler,["-p","tsconfig.json","--pretty","false","--singleThreaded"],{cwd:f.root,env:{...process.env,VIBELANG_RUNTIME:runtime},encoding:"utf8",timeout:60000})
  const stock=spawnSync(process.execPath,[require.resolve("typescript/lib/tsc.js"),"-p","tsconfig.json","--noEmit","--pretty","false"],{cwd:f.root,encoding:"utf8",timeout:60000})
  assert.equal(stock.status,0,stock.stdout+stock.stderr)
  const before=native();assert.equal(before.status,0,before.stdout+before.stderr)
  const declaration=readFileSync(join(f.root,"out/Trace.d.ts"),"utf8")
  const observe=()=>spawnSync(process.execPath,["--input-type=module","-e",'const m=await import("./out/Trace.js?"+Date.now()); console.log(JSON.stringify(m.launch()))'],{cwd:f.root,encoding:"utf8",timeout:60000})
  const beforeRun=observe();assert.equal(beforeRun.status,0,beforeRun.stderr)
  rmSync(join(f.root,"out"),{recursive:true,force:true})
  const state=f.plan();applyState(f.root,state)
  const after=native();assert.equal(after.status,0,after.stdout+after.stderr)
  assert.equal(readFileSync(join(f.root,"out/Trace.d.ts"),"utf8"),declaration)
  const afterRun=observe();assert.equal(afterRun.status,0,afterRun.stderr)
  assert.equal(afterRun.stdout,beforeRun.stdout)
  assert.ok(!existsSync(join(f.root,"src/Trace.platform.ts")))
 }finally{f.dispose()}
})
