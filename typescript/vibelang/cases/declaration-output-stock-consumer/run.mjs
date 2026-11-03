import assert from "node:assert/strict"
import ts from "../../../../docs/tools/node_modules/typescript/lib/typescript.js"
import {mkdtempSync,writeFileSync,rmSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
assert.equal(ts.version,"5.9.3")
for(const suffix of [".vibe",".vibex"])for(const ext of [".ts",".tsx"]){
 const dir=mkdtempSync(join(tmpdir(),"vip27-stock-native-"))
 try{
  writeFileSync(join(dir,"package.json"),'{"type":"module"}')
  writeFileSync(join(dir,"producer"+suffix),"export const value = 42 as const;")
  writeFileSync(join(dir,"producer.d"+suffix+".ts"),"export declare const value: 42;")
  writeFileSync(join(dir,"consumer"+ext),'import {value} from "./producer'+suffix+'"; export const answer:42 = value;')
  const p=ts.createProgram([join(dir,"consumer"+ext)],{noEmit:true,allowArbitraryExtensions:true,jsx:ts.JsxEmit.Preserve,module:ts.ModuleKind.NodeNext,target:ts.ScriptTarget.ES2022,types:[],strict:true})
  assert.deepEqual(ts.getPreEmitDiagnostics(p).map(d=>d.code),[])
 }finally{rmSync(dir,{recursive:true,force:true})}
}
console.log("stock native consumers")
