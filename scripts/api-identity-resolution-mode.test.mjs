import assert from "node:assert/strict"
import {test} from "node:test"
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from "node:fs"
import {dirname,join,resolve} from "node:path"
import {tmpdir} from "node:os"
import {createRequire} from "node:module"
import {compareApiIdentity,loadTypeScript} from "./api-identity.mjs"
import {checkProperty} from "./testing/property.mjs"
const ts=loadTypeScript()
const fc=createRequire(new URL("../docs/tools/package.json",import.meta.url))("fast-check")
const expr=mode=>'import("dual", { with: { "resolution-mode": "'+mode+'" } }).X'
function fixture(before,after,fn) {
 const root=mkdtempSync(join(tmpdir(),"api-identity-resolution-mode-"))
 try {
  for (const [side,input] of [["before",before],["after",after]]) {
   const files={
    "package.json":JSON.stringify({name:"consumer",type:"module",types:input.entry || "./index.d.ts"}),
    "node_modules/dual/package.json":JSON.stringify({name:"dual",version:"1.0.0",type:"module",exports:{".":{import:{types:"./import.d.ts"},require:{types:"./require.d.cts"}}}}),
    "node_modules/dual/import.d.ts":"export type X = "+(input.importType || "string")+";",
    "node_modules/dual/require.d.cts":"export type X = "+(input.requireType || "number")+";",
    [input.entry || "index.d.ts"]:input.index
   }
   for (const [name,text] of Object.entries(files)) {const p=join(root,side,name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,text)}
  }
  return fn(join(root,"before"),join(root,"after"))
 } finally {rmSync(root,{recursive:true,force:true})}
}
function oracle(dir,entry="index.d.ts") {
 const opts={strict:true,noEmit:true,types:[],module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler}
 const program=ts.createProgram([join(dir,entry)],opts),checker=program.getTypeChecker()
 assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>({code:d.code,text:ts.flattenDiagnosticMessageText(d.messageText,"\n")})),[])
 const source=program.getSourceFile(join(dir,entry))
 const symbol=checker.getExportsOfModule(checker.getSymbolAtLocation(source)).find(s=>s.name==="X")
 return checker.typeToString(checker.getDeclaredTypeOfSymbol(symbol),undefined,ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias)
}
function differs(before,after) {
 fixture(before,after,(a,b)=>{
  const at=oracle(a,before.entry),bt=oracle(b,after.entry)
  assert.notEqual(at,bt,"Independent tsc must establish the semantic difference")
  const result=compareApiIdentity(ts,a,b,{moduleRoots:[]})
  assert.equal(result.comparisonComplete,true,JSON.stringify(result))
  assert.equal(result.identical,false,JSON.stringify({at,bt,result}))
  assert.ok(result.typeDifferences.some(d=>d.export==="X" && /TS2344/.test(d.diagnostic)),JSON.stringify(result))
 })
}
test("resolution-mode on import types changes the compared exported type",()=>{
 differs({index:"export type X = "+expr("import")+";"},{index:"export type X = "+expr("require")+";"})
})
test("two usages of one specifier retain their distinct resolution modes",()=>{
 differs({index:"export type X = ["+expr("import")+","+expr("require")+"];"},{index:"export type X = ["+expr("require")+","+expr("import")+"];"})
})
test("unchanged require syntax cannot intern a changed conditional dependency",()=>{
 differs({index:"export type X = "+expr("require")+";"},{index:"export type X = "+expr("require")+";",requireType:"boolean"})
})
test("type import declarations preserve resolution-mode attributes",()=>{
 differs({index:'import type {X as Value} from "dual" with {"resolution-mode":"import"}; export type X=Value;'},{index:'import type {X as Value} from "dual" with {"resolution-mode":"require"}; export type X=Value;'})
})
test("harmless quote changes preserve explicit resolution and self identity",()=>{
 const a={index:"export type X = "+expr("require")+";"}
 const b={index:a.index.replaceAll('"',"'")}
 fixture(a,b,(left,right)=>{
  assert.equal(oracle(left),oracle(right))
  for(const [x,y] of [[left,right],[left,left],[right,right]]) {
   const result=compareApiIdentity(ts,x,y,{moduleRoots:[]})
   assert.equal(result.identical,true,JSON.stringify(result))
  }
 })
})
test("property: stock-tsc conditional branch differences always fail",async()=>{
 await checkProperty(fc,{
  name:"api-identity-resolution-mode",
  rule:"Each export's type is identical to tsc's in both directions; an import's resolution mode selects its published declaration.",
  command:"node --test scripts/api-identity-resolution-mode.test.mjs",
  arbitrary:fc.record({n:fc.integer({min:0,max:10000}),declaration:fc.boolean()}),
  numRuns:4,
  check:({n,declaration})=>{
  const a=declaration
   ? {index:'import type {X as Value} from "dual" with {"resolution-mode":"require"}; export type X=Value;',requireType:String(n)}
   : {index:"export type X = "+expr("require")+";",requireType:String(n)}
  const b={...a,requireType:String(n+1)}
  differs(a,b)
 }
 })
})
