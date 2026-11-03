// VIP-39 selected output example: docs/design/vips/0039-vibex.md#ad97ec13ba67a27a
// VIP-39 selected output example: docs/design/vips/0039-vibex.md#38ddd0d5186fe0e8
// VIP-39 selected output example: docs/design/vips/0039-vibex.md#37f81c337aa67cb8
// VIP-39 Under preserve and react-native those earlier values reach the: docs/design/vips/0039-vibex.md#c55bf72434735ad8
// VIP-39 The project still needs .tsx s settings without jsx: docs/design/vips/0039-vibex.md#62596cc8ccea6f9b
// VIP-39 Options. jsx jsxFactory jsxFragmentFactory jsxImportSource reactNamespace and the jsx: docs/design/vips/0039-vibex.md#6e7ebf3300fcaa8b
// VIP-39 Output names. x.vibex emits x.jsx under jsx preserve and: docs/design/vips/0039-vibex.md#e796b3613acad57b
// VIP-39 This extends VIP-34 s .vibe .js rule: docs/design/vips/0039-vibex.md#8fe15634471b9bbc
// VIP-39 A relative . x.vibex specifier rewrites to . x.jsx: docs/design/vips/0039-vibex.md#d20ca0101ab583ac
// VIP-39 Declarations. x.vibex writes the public x.d.ts to outDir and: docs/design/vips/0039-vibex.md#fca61b52912d1637
// VIP-39 The public x.d.ts is byte-identical to the one the: docs/design/vips/0039-vibex.md#9a2d1686fdcb1c40
// VIP-39 VIP-27 is unchanged a converted component gains throws exactly: docs/design/vips/0039-vibex.md#7738a5896ab23ddb
// VIP-39 Source maps. x.js.map x.jsx.map and x.d.ts.map name x.vibex with: docs/design/vips/0039-vibex.md#d1ed4010f488080c
// VIP-39 Diagnostics. JSX errors keep their TypeScript codes VibeLang errors: docs/design/vips/0039-vibex.md#600ee6e6f420abfe
// VIP-39 EK39xx stays reserved for it: docs/design/vips/0039-vibex.md#a783d4c45fc3a6e3
// VIP-39 vibe .vibex .ts and .tsx import and re-export each: docs/design/vips/0039-vibex.md#e2cb59239e362386
// VIP-39 Resolution treats .vibex as .vibe s .tsx: docs/design/vips/0039-vibex.md#3def2cbde6be4973
// VIP-39 App . App.js App.ts App.tsx App.vibe App.vibex App.d.ts then: docs/design/vips/0039-vibex.md#68b01858a9dd37eb
// VIP-39 App.jsx App.tsx App.ts App.vibex App.vibe App.d.ts App.jsx App.js: docs/design/vips/0039-vibex.md#d7ea782b75881b2e
// VIP-39 App.vibe App.vibe App.d.ts unchanged: docs/design/vips/0039-vibex.md#05bf490d8dfdaa1f
// VIP-39 App.vibex App.vibex App.d.ts: docs/design/vips/0039-vibex.md#5fd2918efd46b2f8
// VIP-39 These orders apply after TypeScript s exports imports paths: docs/design/vips/0039-vibex.md#6e2138730245ab0b
// VIP-39 App.vibe beside App.vibex or App.tsx beside App.vibex get TypeScript: docs/design/vips/0039-vibex.md#bc17372a780d4641
// VIP-39 Their compatibility sidecars stay distinct App.d.vibe.ts and App.d.vibex.ts: docs/design/vips/0039-vibex.md#7c75dd7e78264480
// VIP-39 Pragmas still work inside .vibex: docs/design/vips/0039-vibex.md#19e2a0d6296fb070
// VIP-39 Suppress inferred throws in public .d.ts amend VIP-27 for: docs/design/vips/0039-vibex.md#368c6674354b9b44
// VIP-39 jsx specifiers don t substitute .vibe Sol TypeScript resolves: docs/design/vips/0039-vibex.md#c2f41e9b197a6363
// VIP-39 Vibex output collisions follow the selected native output paths: docs/design/vips/0039-vibex.md#3d2041b59043ac9a
// VIP-39 With jsx preserve and public declaration emission off the: docs/design/vips/0039-vibex.md#632f00db9380756e
// VIP-39 With shared public declaration output enabled both would write: docs/design/vips/0039-vibex.md#77fcf409412fd2de
// VIP-39 A JSX mode that writes both JavaScript inputs as: docs/design/vips/0039-vibex.md#451bfe57f353ffe1
// VIP-39 noEmit declaration-only modes output directories maps and host filename: docs/design/vips/0039-vibex.md#244d065a8c8789f8
// VIP-39 The same conditional output rule applies to a .tsx: docs/design/vips/0039-vibex.md#aa9dc1cf9971f792
// VIP-39 Effect TS explicit App.ts and App.tsx roots containing the: docs/design/vips/0039-vibex.md#f85126f669fd4d69
// VIP-39 Enabling declarations produces native TS5056 for App.d.ts jsx react: docs/design/vips/0039-vibex.md#d3c48b682dbd18e1
// VIP-39 Compatibility sidecars stay separately named App.d.vibe.ts and App.d.vibex.ts a: docs/design/vips/0039-vibex.md#77801de03ee51512
// VIP-39 No new EK code stricter JSX mode source extension: docs/design/vips/0039-vibex.md#598f73e082ab3cdd
// run-seconds: 600
import assert from "node:assert/strict"
import {SourceMap} from "node:module"
import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join, dirname, resolve } from "node:path"
const dir = dirname(fileURLToPath(import.meta.url))
const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const stock = resolve(process.env.EFFECT_NODE_MODULES, "typescript/bin/tsc")
const results = []
const base = { target:"ES2022", module:"ESNext", moduleResolution:"Bundler", jsx:"preserve", strict:true, types:[], skipLibCheck:true, declaration:true, outDir:"out", rootDir:"." }
function check(key, body) { try { body(); results.push({key,ok:true}) } catch(e) { results.push({key,ok:false,error:String(e.stack || e)}) } }
function compile(key, files, options={}, native=false) {
 const cwd = join(dir,"out","projects",key); mkdirSync(cwd,{recursive:true})
 writeFileSync(join(cwd,"package.json"),'{"type":"module"}')
 for(const [name,source] of Object.entries(files)) { mkdirSync(dirname(join(cwd,name)),{recursive:true}); writeFileSync(join(cwd,name),source) }
 writeFileSync(join(cwd,"tsconfig.json"),JSON.stringify({compilerOptions:{...base,...options},files:Object.keys(files).filter(p=>!p.endsWith(".json")&&!p.startsWith("node_modules/"))}))
 const run = spawnSync(native ? process.execPath : compiler, native ? [stock,"-p",cwd,"--pretty","false"] : ["-p",cwd,"--pretty","false"],{encoding:"utf8",timeout:60000})
 assert.notEqual(run.status,null,run.error?.message || "compile timed out")
 return { cwd, text:run.stdout+run.stderr, codes:[...run.stdout.matchAll(/error (TS|EK)([0-9]+)/g)].map(m=>m[1]+m[2]).sort(), status:run.status }
}
const read = (r,p)=>readFileSync(join(r.cwd,p),"utf8")
function clean(r) { assert.equal(r.status,0,r.text) }
const jsx = 'declare global { namespace JSX { type Element = {tag:string}; interface IntrinsicElements { [name:string]:any } } } export {};'
const runtime = 'export function jsx(tag:any,props:any) { return {tag,props} } export {jsx as jsxs, jsx as jsxDEV}; export const Fragment = "fragment"; export namespace JSX { export type Element = {tag:string}; export interface IntrinsicElements { [name:string]:any } }'
for(const mode of ["preserve","react-native","react","react-jsx","react-jsxdev"]) check("mode:"+mode,()=>{
 const files={"App.vibex":'declare function h(...args:any[]): JSX.Element; export const view = <p title="é">{1}</p>',"main.vibe":'export {view} from "./App.vibex"',"jsx.d.ts":jsx,"jsx/jsx-runtime.ts":runtime,"jsx/jsx-dev-runtime.ts":runtime}
 const options={jsx:mode,jsxFactory:"h",rewriteRelativeImportExtensions:true,sourceMap:true,inlineSources:true,declarationMap:true}
 if(mode.startsWith("react-jsx")) { delete options.jsxFactory; options.jsxImportSource="./jsx" }
 const a=compile("mode-"+mode,files,options); clean(a)
 const suffix=mode==="preserve"?"jsx":"js"
 assert.ok(existsSync(join(a.cwd,"out/App."+suffix)))
 assert.equal(read(a,"out/App."+suffix).includes("<p"),mode==="preserve"||mode==="react-native")
 assert.ok(read(a,"out/main.js").includes("./App."+suffix))
 const map=JSON.parse(read(a,"out/App."+suffix+".map"))
 assert.ok(map.sources.some(p=>p.endsWith("App.vibex")))
 assert.ok(map.sourcesContent.some(s=>s.includes('title="é"')))
 assert.ok(JSON.parse(read(a,"out/App.d.ts.map")).sources.some(p=>p.endsWith("App.vibex")))
 assert.ok(existsSync(join(a.cwd,"App.d.vibex.ts")))
 assert.ok(!read(a,"App.d.vibex.ts").includes("<p"))
 const nativeFiles=Object.fromEntries(Object.entries(files).map(([p,s])=>[p.replace(".vibex",".tsx").replace(".vibe",".ts"),s.replace("./App.vibex","./App.tsx")]))
 const b=compile("native-"+mode,nativeFiles,options,true);clean(b)
 assert.equal(read(a,"out/App.d.ts").replace(/sourceMappingURL=.*/,""),read(b,"out/App.d.ts").replace(/sourceMappingURL=.*/,""))
})
check("no-jsx",()=>{
 const a=compile("no-jsx",{"App.vibex":"export const view=<p/>","main.vibe":'export {view} from "./App.vibex"',"jsx.d.ts":jsx},{jsx:undefined,noEmit:true,allowImportingTsExtensions:true})
 assert.deepEqual(a.codes,["TS17004","TS6142"])
 const b=compile("native-no-jsx",{"App.tsx":"export const view=<p/>","main.ts":'export {view} from "./App.tsx"',"jsx.d.ts":jsx},{jsx:undefined,noEmit:true,allowImportingTsExtensions:true},true)
 assert.deepEqual(a.codes,b.codes)
})
check("pragma",()=>{
 const a=compile("pragma",{"App.vibex":"/** @jsx custom */\ndeclare function custom(...args:any[]): any; export const view=<p/>","jsx.d.ts":jsx},{jsx:"react",jsxFactory:"wrong",declaration:false});clean(a)
 assert.ok(read(a,"out/App.js").includes('custom("p"'))
})
check("sidecar-consumer",()=>{
 const a=compile("sidecar-source",{"App.vibex":"export const n = 1"},{}); clean(a)
 const b=compile("sidecar-consumer",{"App.d.vibex.ts":read(a,"App.d.vibex.ts"),"main.ts":'import {n} from "./App.vibex"; const check: 1 = n; export {check}'},{noEmit:true,allowArbitraryExtensions:true},true);clean(b)
})
for(const [specifier,order] of Object.entries({"./App":["ts","tsx","vibe","vibex","d.ts","js"],"./App.js":["ts","tsx","vibe","vibex","d.ts","js"],"./App.jsx":["tsx","ts","vibex","vibe","d.ts","jsx","js"],"./App.vibe":["vibe","d.ts"],"./App.vibex":["vibex","d.ts"]})) check("resolution:"+specifier,()=>{
 for(let start=0;start<order.length;start++) {
  const files={"main.vibe":'import {kind} from "'+specifier+'"; export const selected: "'+order[start]+'" = kind'}
  for(const ext of order.slice(start)) files["App."+ext]=ext==="d.ts"?'export declare const kind: "'+ext+'"':'export const kind = "'+ext+'"'
  const a=compile("resolution-"+specifier.replaceAll("/","_").replaceAll(".","_")+"-"+start,files,{noEmit:true,declaration:false,allowJs:true,checkJs:true,allowImportingTsExtensions:true});clean(a)
 }
})
for(const mode of ["preserve","react"]) for(const kind of ["none","declarations","only","noEmit"]) check("collision:"+mode+":"+kind,()=>{
 const options={jsx:mode,declaration:kind==="declarations"||kind==="only",emitDeclarationOnly:kind==="only",noEmit:kind==="noEmit"}
 const a=compile("collision-"+mode+"-"+kind,{"App.vibe":"export const a=1","App.vibex":"export const b=2"},options)
 const b=compile("native-collision-"+mode+"-"+kind,{"App.ts":"export const a=1","App.tsx":"export const b=2"},options,true)
 assert.deepEqual(a.codes,b.codes,a.text+"\n"+b.text)
 if(a.status===0 && kind!=="noEmit") {
  assert.ok(existsSync(join(a.cwd,"out/App.js")));assert.ok(existsSync(join(a.cwd,"out/App.jsx")))
  assert.ok(existsSync(join(a.cwd,"App.d.vibe.ts")));assert.ok(existsSync(join(a.cwd,"App.d.vibex.ts")))
 }
})
check("do-snapshot:preserve",()=>snapshot("preserve"))
check("do-snapshot:react-native",()=>snapshot("react-native"))
function snapshot(mode) {
 const a=compile("do-snapshot-"+mode,{"App.vibex":'declare function h(...args:any[]):JSX.Element; export function view(props:{a:number},stop:boolean): number|JSX.Element { return <box a={props.a} b={do { if(stop) return 7; 1 }}/>} ',"jsx.d.ts":jsx},{jsx:mode})
 clean(a)
 const output=read(a,"out/App."+(mode==="preserve"?"jsx":"js"))
 assert.equal(output.split("props.a").length-1,1,output)
 assert.ok(!/a\s*=\s*\{\s*props\.a\s*\}/.test(output),output)
}
check("keyword-source-map",()=>{
 const source='import {Effect} from "effect"; export effect function task() { return try Effect.succeed(1) }'
 const a=compile("keyword-source-map",{"App.vibex":source},{jsx:"react",sourceMap:true,inlineSources:true})
 clean(a)
 const output=read(a,"out/App.js"), at=output.indexOf("yield*")
 assert.ok(at>=0,output)
 const prefix=output.slice(0,at).split("\n")
 const entry=new SourceMap(JSON.parse(read(a,"out/App.js.map"))).findEntry(prefix.length-1,prefix.at(-1).length)
 assert.ok(entry.originalSource.endsWith("App.vibex"))
 assert.deepEqual([entry.originalLine,entry.originalColumn],[0,source.indexOf("try")])
})
check("declaration-map-content",()=>{
 const source="export const value = 1"
 const a=compile("declaration-map-content",{"App.vibex":source},{sourceMap:true,inlineSources:true,declarationMap:true});clean(a)
 const map=JSON.parse(read(a,"out/App.d.ts.map"))
 assert.ok(map.sources.some(p=>p.endsWith("App.vibex")))
 assert.ok(map.sourcesContent?.includes(source),"VIP-39 requires sourcesContent in the declaration map")
})
for(const mode of ["preserve","react"]) for(const kind of ["none","declarations","only","noEmit"]) check("collision-tsx:"+mode+":"+kind,()=>{
 const a=compile("collision-tsx-"+mode+"-"+kind,{"App.tsx":"export const a=1","App.vibex":"export const b=2"},
 {jsx:mode,declaration:kind==="declarations"||kind==="only",emitDeclarationOnly:kind==="only",noEmit:kind==="noEmit"})
 assert.deepEqual(a.codes,Array(kind==="noEmit"?0:kind==="declarations"?2:1).fill("TS5056"),a.text)
})
for(const [key,files,options] of [
 ["paths",{"main.vibe":'import {kind} from "widget"; export const selected: "live"=kind',"src/App.vibex":'export const kind="live"'},{paths:{"widget":["./src/App"]}}],
 ["suffix",{"main.vibe":'import {kind} from "./App.js"; export const selected: "native"=kind',"App.vibex":'export const kind="default"',"App.native.vibex":'export const kind="native"'},{moduleSuffixes:[".native",""]}],
 ["exports",{"main.vibe":'import {kind} from "widget"; export const selected: "live"=kind',"node_modules/widget/package.json":JSON.stringify({type:"module",exports:{".":{types:"./App.vibex",default:"./App.js"}}}),"node_modules/widget/App.vibex":'export const kind="live"'},{}],
 ["imports",{"main.vibe":'import {kind} from "#widget"; export const selected: "live"=kind',"package.json":JSON.stringify({type:"module",imports:{"#widget":"./src/App.vibex"}}),"src/App.vibex":'export const kind="live"'},{}],
 ["live-sidecar",{"main.vibe":'import {kind} from "./App.vibex"; export const selected: "live"=kind',"App.vibex":'export const kind="live"',"App.d.vibex.ts":'export declare const kind:"stale"'},{}]
]) check("resolution-context:"+key,()=>{
 const config={...options,noEmit:true,allowImportingTsExtensions:true,declaration:false}
 const nativeFiles=Object.fromEntries(Object.entries(files).map(([p,v])=>[p.replaceAll(".vibex",".tsx").replaceAll(".vibe",".ts"),v.replaceAll(".vibex",".tsx").replaceAll(".vibe",".ts")]))
 const b=compile("context-native-"+key,nativeFiles,config,true);clean(b)
 const a=compile("context-"+key,files,config);clean(a)
})
check("nodenext-extension",()=>{
 const opts={module:"NodeNext",moduleResolution:"NodeNext",noEmit:true,declaration:false}
 const b=compile("native-nodenext",{"main.ts":'import {value} from "./App"; export {value}',"App.tsx":"export const value=1"},opts,true)
 const a=compile("nodenext",{"main.vibe":'import {value} from "./App"; export {value}',"App.vibex":"export const value=1"},opts)
 assert.deepEqual(b.codes,["TS2835"],b.text);assert.deepEqual(a.codes,b.codes,a.text)
})
writeFileSync(join(dir,"out/census-results.json"),JSON.stringify(results,null,2))
const failed=results.filter(r=>!r.ok)
assert.deepEqual(failed,[],"VIP-39 conformance gaps: "+JSON.stringify(failed))

console.log("VIP-39 PASS")
