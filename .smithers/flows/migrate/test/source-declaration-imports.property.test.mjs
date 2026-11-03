import assert from "node:assert/strict"
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync,renameSync} from "node:fs"
import {join,dirname} from "node:path"
import {tmpdir} from "node:os"
import {createRequire} from "node:module"
import {spawnSync} from "node:child_process"
import {test} from "node:test"
import {fileURLToPath} from "node:url"
import {rewritePublishingScript} from "../lib/publishing.mjs"
import {wireEmittedProjects} from "../lib/steps.mjs"
import {sourceTypeEdges,runtimeEdges} from "../lib/emitted-imports.mjs"
import {routeSourceDeclarationImports,planSourceDeclarationImports} from "../lib/source-declaration-imports.mjs"
import {checkProperty} from "../../../../scripts/testing/property.mjs"
const require=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))
const ts=require("typescript"),fc=require("fast-check")
const corpus=JSON.parse(readFileSync(new URL("./corpus/opencode-figma-foreign-sidecar.json",import.meta.url),"utf8"))
const config={compilerOptions:{module:"preserve",moduleResolution:"bundler",strict:true,noEmit:true,allowArbitraryExtensions:true,allowImportingTsExtensions:true},include:["src"]}
function fixture({folder=".vibe/declarations",nested="schema",basename="options"}={}) {
 const root=mkdtempSync(join(tmpdir(),"opencode-foreign-header-"))
 const put=(file,text)=>{mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),text)}
 const read=file=>readFileSync(join(root,file),"utf8")
 const json=(file,value)=>put(file,JSON.stringify(value,null,2)+"\n")
 json("package.json",{type:"module",private:true})
 json("ai/package.json",{name:"probe-ai",type:"module"})
 json("ai/tsconfig.json",{...config,vibe:{sidecarDir:folder},compilerOptions:{...config.compilerOptions,rootDirs:[".",folder]}})
 json("consumer/tsconfig.json",{...config,include:["index.ts"]})
 json("consumer/package.json",{name:"probe-consumer",type:"module"})
 const target=nested+"/"+basename
 put("ai/src/cache-policy.ts",corpus.nativeImporter.replace("schema/options",target))
 put("ai/src/"+target+".vibe",corpus.source)
 put("ai/"+folder+"/src/"+target+".d.vibe.ts",corpus.declaration)
 put("consumer/index.ts",corpus.consumer)
 const packages=[{dir:"ai",tsconfig:"tsconfig.json"}]
 const route=options=>routeSourceDeclarationImports({root,packages,ts,...options})
 const plan=options=>planSourceDeclarationImports({root,packages,ts,...options})
 return {root,put,read,json,route,plan,target,folder,dispose:()=>rmSync(root,{recursive:true,force:true})}
}
test("opencode Figma: private metadata resolves the physical foreign header",()=>{
 const f=fixture()
 try{
  const source=f.read("ai/src/schema/options.vibe"),header=f.read("ai/.vibe/declarations/src/schema/options.d.vibe.ts"),consumer=f.read("consumer/index.ts")
  const result=f.route()
  assert.deepEqual(result.warnings,[])
  assert.deepEqual(result.changed,["ai/package.json","ai/src/cache-policy.ts"])
  assert.deepEqual(JSON.parse(f.read("ai/package.json")).imports["#vibelang/source/src/schema/options"],{types:"./.vibe/declarations/src/schema/options.d.vibe.ts","vibelang-source":"./src/schema/options.vibe",default:"./src/schema/options.vibe"})
  assert.ok(f.read("ai/src/cache-policy.ts").includes('from "#vibelang/source/src/schema/options"'))
  assert.equal(f.read("ai/src/schema/options.vibe"),source)
  assert.equal(f.read("ai/.vibe/declarations/src/schema/options.d.vibe.ts"),header)
  assert.equal(f.read("consumer/index.ts"),consumer)
  assert.deepEqual(f.route().changed,[])
 }finally{f.dispose()}
})
test("native syntax edges include erased imports, export types and import types without reading examples",()=>{
 const text='import type { A } from "./a.vibe";\nimport {type B} from "./b.vibe";\nexport type { C } from "./c.vibe";\nexport type D = import("./d.vibe").D;\nexport type E = typeof import("./e.vibe");\nexport const load = () => import("./f.vibe", {with:{type:"json"}});\n// import type { Bad } from "./bad.vibe";\nconst example = \'import("./example.vibe")\';\n'
 assert.deepEqual(sourceTypeEdges(text,"edges.ts",ts).map(edge=>edge.specifier),["./a.vibe","./b.vibe","./c.vibe","./d.vibe","./e.vibe","./f.vibe"])
 assert.deepEqual(runtimeEdges(text,"edges.ts",ts).map(edge=>edge.specifier),["./f.vibe"])
})
test("emitted consumers use the compiler's actual output while source metadata stays physical",()=>{
 const f=fixture()
 try{
  f.route()
  f.put("ai/.vibelang/js/actual/options.js","export const CacheHint = policy => policy.tools ?? false\n")
  const emitted=new Map([["ai",{"./src/schema/options.vibe":"./.vibelang/js/actual/options.js"}]])
  f.route({emitted})
  const target=JSON.parse(f.read("ai/package.json")).imports["#vibelang/source/src/schema/options"]
  assert.equal(target.default,"./.vibelang/js/actual/options.js")
  assert.equal(target["vibelang-source"],"./src/schema/options.vibe")
  assert.equal(target.types,"./.vibe/declarations/src/schema/options.d.vibe.ts")
  assert.deepEqual(f.route({emitted}).changed,[])
 }finally{f.dispose()}
})
test("restore removes generated routes and keeps the original relative source import",()=>{
 const f=fixture()
 try{
  const original=f.read("ai/src/cache-policy.ts"),manifest=f.read("ai/package.json")
  f.route();f.route({restore:true})
  assert.equal(f.read("ai/src/cache-policy.ts"),original)
  assert.equal(f.read("ai/package.json"),manifest)
 }finally{f.dispose()}
})
test("tests, fixtures and conflicting authored routes are preserved atomically",()=>{
 const f=fixture()
 try{
  for(const path of ["ai/src/value.test.ts","ai/src/fixtures/example.ts"])f.put(path,corpus.nativeImporter)
  f.route()
  assert.equal(f.read("ai/src/value.test.ts"),corpus.nativeImporter)
  assert.equal(f.read("ai/src/fixtures/example.ts"),corpus.nativeImporter)
 }finally{f.dispose()}
 const g=fixture()
 try{
  g.json("ai/package.json",{name:"probe-ai",type:"module",imports:{"#vibelang/source/src/schema/options":"./authored.ts"}})
  const before=g.read("ai/src/cache-policy.ts"),manifest=g.read("ai/package.json")
  assert.throws(()=>g.route(),/conflicting import/)
  assert.equal(g.read("ai/src/cache-policy.ts"),before);assert.equal(g.read("ai/package.json"),manifest)
 }finally{g.dispose()}
})
test("native source priority and beside declarations need no new routes",()=>{
 const f=fixture()
 try{
  f.put("ai/src/schema/options.ts",corpus.source)
  const original=corpus.nativeImporter.replaceAll("./schema/options.vibe","./schema/options.js")
  f.put("ai/src/cache-policy.ts",original)
  assert.deepEqual(f.route().changed,[])
  f.put("ai/src/cache-policy.ts",corpus.nativeImporter)
  assert.ok(f.route().changed.length)
 }finally{f.dispose()}
 const g=fixture()
 try{
  g.json("ai/tsconfig.json",config)
  g.put("ai/src/schema/options.d.vibe.ts",corpus.declaration)
  assert.deepEqual(g.route().changed,[])
 }finally{g.dispose()}
})
test("property: hidden declarations remain physical through native import forms and nested layouts",async()=>{
 await checkProperty(fc,{name:"opencode-figma-foreign-sidecar",rule:"A foreign native checker cannot use the source package's rootDirs; its private types route must name the actual physical compatibility declaration and preserve the runtime source.",command:"node --test .smithers/flows/migrate/test/source-declaration-imports.property.test.mjs",numRuns:160,
  arbitrary:fc.record({nativeTwin:fc.boolean(),nested:fc.constantFrom("schema","types/nested","a/b/c"),basename:fc.constantFrom("options","model-2","public"),folder:fc.constantFrom(".vibe/declarations",".private/types"),kind:fc.constantFrom("value","type","export","importType","dynamic","requireType")}),
  check:input=>{
   const f=fixture(input)
   try{
    const name="./"+f.target+".vibe"
    const forms={value:'import { CacheHint } from "'+name+'";\nexport const x = CacheHint({});\n',type:'import type { CachePolicyObject } from "'+name+'";\nexport type X = CachePolicyObject;\n',export:'export type { CachePolicyObject } from "'+name+'";\n',importType:'export type X = import("'+name+'").CachePolicyObject;\n',dynamic:'export const load = () => import("'+name+'");\n'}
    forms.requireType='import Options = require("'+name+'"); export type X = Options.CachePolicyObject;'+String.fromCharCode(10)
    if(input.nativeTwin)f.put("ai/src/"+f.target+".ts",corpus.source.replace("policy.tools ?? false","false"))
    f.put("ai/src/cache-policy.ts",forms[input.kind])
    const result=f.route();assert.deepEqual(result.warnings,[])
    const data=JSON.parse(f.read("ai/package.json")).imports
    assert.equal(Object.keys(data).length,1)
    const target=Object.values(data)[0]
    assert.equal(target.types,"./"+f.folder+"/src/"+f.target+".d.vibe.ts")
    assert.equal(target.default,target["vibelang-source"])
    assert.ok(existsSync(join(f.root,"ai",target.types)))
    assert.deepEqual(f.route().changed,[])
    f.route({restore:true});assert.equal(f.read("ai/src/cache-policy.ts"),forms[input.kind])
   }finally{f.dispose()}
  }})
})
const bunHelp=spawnSync("bun",["check","--help"],{encoding:"utf8"})
const nativeBun=bunHelp.status===0&&(bunHelp.stdout+bunHelp.stderr).includes("--no-script")&&(bunHelp.stdout+bunHelp.stderr).includes("--threads")
test("native Bun checker: setup wires the foreign hidden declaration without changing the command",{skip:!nativeBun&&!process.env.VIBELANG_BUN_NATIVE_CHECK_REQUIRE},async()=>{
 assert.ok(nativeBun,"Bun with native check is required for this qualification")
 const f=fixture()
 const run=()=>spawnSync("bun",["check","--no-script","--threads","4","-p","consumer/tsconfig.json"],{cwd:f.root,encoding:"utf8",timeout:60000})
 try{
  f.put("ai/src/schema/options.ts",corpus.source)
  f.put("ai/src/cache-policy.ts",corpus.nativeImporter.replaceAll("./schema/options.vibe","./schema/options.ts"))
  const native=run();assert.equal(native.status,0,native.stdout+native.stderr)
  rmSync(join(f.root,"ai/src/schema/options.ts"))
  f.put("ai/src/cache-policy.ts",corpus.nativeImporter)
  const before=run();assert.notEqual(before.status,0);assert.match(before.stdout+before.stderr,/TS2307/)
  const wired=await wireEmittedProjects({target:f.root,packages:[{dir:"ai",tsconfig:"tsconfig.json"}],toolchain:{kind:"installed"}},ts,join(f.root,"logs"))
  const after=run();assert.equal(after.status,0,after.stdout+after.stderr)
  assert.ok(wired.changed.includes("ai/src/cache-policy.ts"))
 }finally{f.dispose()}
})

test("reverted and migrated source counterparts retain one physical route",()=>{
 const f=fixture()
 try{
  f.route()
  renameSync(join(f.root,"ai/src/schema/options.vibe"),join(f.root,"ai/src/schema/options.ts"))
  f.route()
  let target=JSON.parse(f.read("ai/package.json")).imports["#vibelang/source/src/schema/options"]
  assert.equal(target.types,"./src/schema/options.ts")
  assert.equal(target.default,"./src/schema/options.ts")
  renameSync(join(f.root,"ai/src/schema/options.ts"),join(f.root,"ai/src/schema/options.vibe"))
  f.route()
  target=JSON.parse(f.read("ai/package.json")).imports["#vibelang/source/src/schema/options"]
  assert.equal(target.types,"./.vibe/declarations/src/schema/options.d.vibe.ts")
  assert.equal(target.default,"./src/schema/options.vibe")
 }finally{f.dispose()}
})
test("generated importers, absent headers and cross-package targets retain their source with reasons",()=>{
 const f=fixture()
 try{
  f.put("ai/src/cache-policy.ts","// @generated; do not edit\n"+corpus.nativeImporter)
  let result=f.route()
  assert.deepEqual(result.changed,[]);assert.match(result.warnings[0].reason,/generated native/)
  f.put("ai/src/cache-policy.ts",corpus.nativeImporter)
  rmSync(join(f.root,"ai/.vibe/declarations/src/schema/options.d.vibe.ts"))
  result=f.route();assert.deepEqual(result.changed,[]);assert.match(result.warnings[0].reason,/not emitted/)
  f.json("other/package.json",{name:"other"})
  f.put("other/options.vibe",corpus.source)
  f.put("ai/src/cache-policy.ts",'export type { CachePolicyObject } from "../../other/options.vibe"\n')
  result=f.route();assert.deepEqual(result.changed,[]);assert.match(result.warnings[0].reason,/package boundary/)
 }finally{f.dispose()}
})

test("private declaration routes preserve one unique-symbol identity and reject copied brands",()=>{
 const f=fixture()
 const diagnose=()=>ts.getPreEmitDiagnostics(ts.createProgram([join(f.root,"consumer/index.ts")],{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,strict:true,noEmit:true,allowImportingTsExtensions:true,allowArbitraryExtensions:true,types:[],skipLibCheck:false})).map(d=>({code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText," ")}))
 try{
  const source=corpus.source.replace("readonly tools?: boolean","readonly tools?: boolean; readonly brand: unique symbol")
  const header=corpus.declaration.replace("readonly tools?: boolean","readonly tools?: boolean; readonly brand: unique symbol")
  f.put("ai/src/schema/options.vibe",source)
  f.put("ai/.vibe/declarations/src/schema/options.d.vibe.ts",header)
  f.put("ai/src/cache-policy.ts",'export type { CachePolicyObject } from "./schema/options.vibe"\n')
  f.put("consumer/index.ts",'import type {CachePolicyObject as Via} from "../ai/src/cache-policy.ts"; import type {CachePolicyObject as Direct} from "../ai/.vibe/declarations/src/schema/options.d.vibe.ts"; declare const value: Via; const same: Direct = value; export {same};\n')
  f.route();assert.deepEqual(diagnose(),[])
  f.put("ai/.vibe/declarations/src/schema/copy.d.vibe.ts",header)
  f.put("consumer/index.ts",f.read("consumer/index.ts").replace("schema/options.d.vibe.ts","schema/copy.d.vibe.ts"))
  assert.ok(diagnose().some(d=>d.code===2322),"a copied unique symbol must remain distinct")
 }finally{f.dispose()}
})
test("source-route publication uses the native build without changing emitted bundler routes",()=>{
 const native=JSON.parse(readFileSync(new URL("./corpus/opencode-sdk-conditional-imports.json",import.meta.url),"utf8")).source
 for(const binding of ["conditions","key","target","__vibelangKey"]) {
  const script=native.replace("map(([key, conditions]) => [\n        key,","map(([__vibelangTarget, conditions]) => [\n        __vibelangTarget,").replaceAll("conditions",binding)
  const rewritten=rewritePublishingScript(script,ts,"pack.ts")
  const output={}
  new Function("exports",ts.transpileModule(rewritten.text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(output)
  const target={types:"./.vibe/declarations/src/schema/options.d.vibe.ts","vibelang-source":"./src/schema/options.vibe",default:"./.vibelang/js/actual/options.js"}
  const packed=output.packImports({imports:{"#vibelang/source/src/schema/options":structuredClone(target),"#vibelang/emitted/src/schema/options":structuredClone(target)}},"schema")
  assert.equal(packed.imports["#vibelang/source/src/schema/options"].types,"./dist/schema/options.d.ts")
  assert.equal(packed.imports["#vibelang/source/src/schema/options"].default,"./dist/schema/options.js")
  assert.equal(packed.imports["#vibelang/emitted/src/schema/options"].default,target.default)
  assert.equal(rewritePublishingScript(rewritten.text,ts,"pack.ts").text,rewritten.text)
 }
})

test("native import-equals types keep their literal module edge",()=>{
 const source='import Options = require("./options.vibe"); export type X = Options.CachePolicyObject;'
 assert.deepEqual(sourceTypeEdges(source,"file.cts",ts).map(edge=>edge.specifier),["./options.vibe"])
})
const nativeCompiler=process.env.VIBELANG_BINARY??fileURLToPath(new URL("../../../../packages/compiler/native/vibelang",import.meta.url))
test("a migrated importer retains and restores its native-parsed type edges",{skip:!existsSync(nativeCompiler)&&!process.env.VIBELANG_SOURCE_ROUTE_RUNTIME_REQUIRE},()=>{
 assert.ok(existsSync(nativeCompiler))
 for(const code of [
  'import type {CachePolicyObject} from "./schema/options.vibe"; export type X = CachePolicyObject;\n',
  'export type X = import("./schema/options.vibe").CachePolicyObject;\n',
  'export type X = typeof import("./schema/options.vibe");\n',
 ]) {
  const f=fixture()
  try {
   f.put("ai/src/cache-policy.ts",code);f.route()
   renameSync(join(f.root,"ai/src/cache-policy.ts"),join(f.root,"ai/src/cache-policy.vibe"))
   assert.deepEqual(f.route({compiler:nativeCompiler}).changed,[])
   f.route({restore:true,compiler:nativeCompiler})
   assert.equal(f.read("ai/src/cache-policy.vibe"),code)
  }finally{f.dispose()}
 }
})
