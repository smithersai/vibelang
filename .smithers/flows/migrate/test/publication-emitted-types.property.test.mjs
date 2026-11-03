import assert from "node:assert/strict"
import { mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync } from "node:fs"
import { dirname,join } from "node:path"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { test } from "node:test"
import { loadTypeScript } from "../lib/declarations.mjs"
import { routeBundledImports } from "../lib/bundled-imports.mjs"
import { rewritePublishingScript } from "../lib/publishing.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
const runtime=new URL("../../../../packages/runtime/",import.meta.url).pathname
const ts=loadTypeScript([runtime]),fc=createRequire(runtime+"package.json")("fast-check")
const nativeScript=JSON.parse(readFileSync(new URL("./corpus/opencode-sdk-conditional-imports.json",import.meta.url),"utf8")).source
const actual=JSON.parse(readFileSync(new URL("./corpus/opencode-publication-emitted-types.json",import.meta.url),"utf8"))
const quote="`x.vibe` emits `x.js` beside `x.d.ts` in `outDir`"
const diagnostics=(root,file)=>ts.getPreEmitDiagnostics(ts.createProgram([join(root,file)],{strict:true,noEmit:true,skipLibCheck:false,types:[],lib:["lib.es5.d.ts"],target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler})).map(d=>({code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText," ")}))
const execute=(source,pkg,name)=>{
 const out={}
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true})
 assert.deepEqual(compiled.diagnostics,[])
 new Function("exports",compiled.outputText)(out)
 return out.packImports(pkg,name)
}
function legacyScript() {
 const explicit='target !== null && typeof target === "object" && "vibelang-source" in target && typeof target["vibelang-source"] === "string"'
 const paired='target !== null && typeof target === "object" && "default" in target && typeof target.default === "string" && target.default.endsWith(".vibe") && "types" in target && target.types === target.default.slice(0, -5) + ".d.vibe.ts"'
 const generated='Object.fromEntries(Object.entries(conditions).map(([key, target]: [string, unknown]) => [key, '+explicit+' ? target["vibelang-source"] : '+paired+' ? target.default : target]))'
 return nativeScript.replace("Object.entries(conditions)","Object.entries(("+generated+" as typeof conditions))").replace("/\\.ts$/","/\\.(?:ts|vibe)$/")
}
test("published emitted types oracle quotes Chapter 7",()=>assert.ok(readFileSync(SpecPath("007-tooling.md"),"utf8").includes(quote)))
test("actual opencode packed-types witness fails while its native counterpart checks clean",()=>{
 const root=mkdtempSync(join(tmpdir(),"opencode-actual-packed-types-"))
 try {
  for(const side of ["before","after"]) {
   for(const [file,text]of Object.entries(actual[side])){mkdirSync(dirname(join(root,side,file)),{recursive:true});writeFileSync(join(root,side,file),text)}
  }
  assert.deepEqual(diagnostics(join(root,"before"),"consumer.ts"),[])
  assert.ok(diagnostics(join(root,"after"),"consumer.ts").some(d=>d.code===7016))
 } finally {rmSync(root,{recursive:true,force:true})}
})
function scenario(input) {
 const root=mkdtempSync(join(tmpdir(),"opencode-publication-types-"))
 const put=(file,text)=>{mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),typeof text==="string"?text:JSON.stringify(text))}
 const stem=input.stem,source="src/"+stem+".vibe",alias="#vibelang/emitted/src/"+stem
 const types=input.package==="core"?"dist/types/":"dist/"
 const platform=types+stem+".node.d.ts"
 const relative="./"+stem.split("/").at(-1)+".js"
 const declaration="export interface Sqlite { readonly connected: true }\n"
 try {
  put("package.json",{name:"opencode-types-fixture",type:"module",exports:{".":"./"+source},imports:{"#native":{types:"./src/keep.ts",node:"./src/keep.ts"}}})
  put(source,"export interface Sqlite { readonly connected: true }\nexport const Sqlite = (): Sqlite => ({ connected: true })\n")
  put("src/"+stem+".node.ts",'import { Sqlite } from "'+(input.routed?alias:relative.replace(/\.js$/,".vibe"))+'"; export const client = Sqlite()\n')
  put(".vibelang/js/src/"+stem+".js","export const Sqlite = () => ({ connected: true })\n")
  if(input.hidden)put(".vibe/declarations/src/"+stem+".d.vibe.ts",declaration)
  else put("src/"+stem+".d.vibe.ts",declaration)
  put(types+stem+".d.ts",declaration)
  put(platform,'import type { Sqlite } from "'+relative+'"; export declare const client: Sqlite;\n')
  const consumer='import { client } from "./'+platform.replace(/\.d\.ts$/,".js")+'"; const yes: true = client.connected; export { yes };\n'
  put("consumer.ts",consumer)
  assert.deepEqual(diagnostics(root,"consumer.ts"),[],"native declaration counterpart")
  if(input.routed) {
   const pkg=JSON.parse(readFileSync(join(root,"package.json"),"utf8"))
   pkg.imports["#vibelang/emitted/*"]={types:input.hidden?"./.vibe/declarations/*.d.vibe.ts":"./*.d.vibe.ts","vibelang-source":"./*.vibe",default:"./.vibelang/js/*.js"}
   put("package.json",pkg)
  }
  routeBundledImports({root,packages:[{dir:".",sources:["src"]}],ts,bundled:new Set([source])})
  const sourceManifest=readFileSync(join(root,"package.json"),"utf8")
  const pkg=JSON.parse(sourceManifest)
  const routed=ts.createSourceFile("source.ts",readFileSync(join(root,"src/"+stem+".node.ts"),"utf8"),ts.ScriptTarget.Latest,true).statements.find(ts.isImportDeclaration).moduleSpecifier.text
  assert.equal(routed,alias)
  let script=(input.legacy?legacyScript():nativeScript).replace("map(([key, conditions]) => [\n        key,","map(([entryKey, conditions]) => [\n        entryKey,").replace(/\bconditions\b/g,input.binding??"conditions")
  if(input.javascript)script=ts.transpileModule(script,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ESNext}}).outputText
  const fileName=input.javascript?"pack.mjs":"pack.ts"
  const rewritten=rewritePublishingScript(script,ts,fileName)
  const packed=execute(rewritten.text,structuredClone(pkg),input.package)
  const nativeConditions=execute(nativeScript,{imports:{"#native":{types:"./src/keep.ts",node:"./src/keep.ts"}}},input.package).imports["#native"]
  assert.deepEqual(packed.imports["#native"],nativeConditions,"authored native conditions preserve their original mapper")
  assert.equal(packed.imports[alias].default,pkg.imports[alias].default,"runtime target remains the committed JavaScript")
  put("package.json",packed)
  put(platform,'import type { Sqlite } from "'+routed+'"; export declare const client: Sqlite;\n')
  assert.deepEqual(diagnostics(root,"consumer.ts"),[],"packed private import must resolve actual regular declarations")
  put("consumer.ts",consumer.replace("yes: true","yes: false"))
  assert.ok(diagnostics(root,"consumer.ts").some(d=>d.code===2322),"the public literal type must not become any")
  assert.equal(readFileSync(join(root,types+stem+".d.ts"),"utf8"),declaration,"declaration bytes remain unchanged")
  assert.equal(rewritePublishingScript(rewritten.text,ts,fileName).text,rewritten.text,"publication refresh is byte-idempotent")
  put("package.json",sourceManifest)
  assert.deepEqual(routeBundledImports({root,packages:[{dir:".",sources:["src"]}],ts,bundled:new Set([source])}).changed,[],"route refresh is idempotent")
 } finally {rmSync(root,{recursive:true,force:true})}
}
test("opencode Core packed private import selects dist/types declarations",()=>scenario({stem:"database/sqlite",package:"core",hidden:true,routed:false,legacy:false}))
test("opencode Schema upgrades an existing wildcard and old publication wrapper",()=>scenario({stem:"location",package:"schema",hidden:true,routed:true,legacy:true}))
test("property: actual packed declaration targets preserve native consumer types",async()=>{
 await checkProperty(fc,{name:"opencode-published-emitted-types",rule:quote+"; every emitted declaration import must resolve its published declaration, retaining the exported literal type.",command:"node --test .smithers/flows/migrate/test/publication-emitted-types.property.test.mjs",
  arbitrary:fc.record({stem:fc.constantFrom("database/sqlite","location","model","nested/event/value"),package:fc.constantFrom("core","schema","sdk"),hidden:fc.boolean(),routed:fc.boolean(),legacy:fc.boolean(),binding:fc.constantFrom("conditions","key","target"),javascript:fc.boolean()}),numRuns:80,check:scenario})
})
