import assert from "node:assert/strict"
import test from "node:test"
import ts from "typescript"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { block, chapter, run, tools } from "./spec-witness.mjs"
function check(source,options={}){
 const dir=mkdtempSync(join(tools,".pattern-options-"))
 try{
  const file=join(dir,"witness.mts");writeFileSync(file,source)
  const p=ts.createProgram([file],{strict:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,noEmit:true,skipLibCheck:true,...options})
  return ts.getPreEmitDiagnostics(p).filter(d=>d.file?.fileName===file).map(d=>({code:d.code,line:d.file.getLineAndCharacterOfPosition(d.start).line,text:ts.flattenDiagnosticMessageText(d.messageText," ")}))
 }finally{rmSync(dir,{recursive:true,force:true})}
}
test("pattern typing is option-sensitive and carries presence without removing payload undefined",()=>{
 const text=chapter("004-match")
 assert.ok(!text.includes("These types hold under every compiler option"))
 assert.ok(text.includes("Other options change a binding as they change its counterpart's value"))
 assert.ok(text.includes("A payload that includes `undefined` keeps that type after the presence test"))
})
test("actual printed extraction counterparts preserve checked presence under access options",{timeout:180000},()=>{
 const text=chapter("004-match")
 const numeric=block(text,"const numericMatcher")
 const pairs=block(text,"function pairCacheWitness")
 for(const strictBuiltinIteratorReturn of [true,false]){
  for(const flags of [{},{noUncheckedIndexedAccess:true},{noPropertyAccessFromIndexSignature:true},{noUncheckedIndexedAccess:true,noPropertyAccessFromIndexSignature:true}]){
   assert.deepEqual(check(numeric,{...flags,strictBuiltinIteratorReturn}),[])
   assert.deepEqual(check(pairs,{...flags,strictBuiltinIteratorReturn}),[])
  }
 }
 const r=run(numeric+'\nif(JSON.stringify([first([]),first([1]),first([1,2]),numeric(7)])!==JSON.stringify(["other","1","other","7"])) throw new Error("pattern witness changed")')
 assert.equal(r.status,0,r.stderr)
 const union=numeric.replace("function first(s: number[])","function first(s: (number | undefined)[])").replace("IteratorResult<number, undefined>","IteratorResult<number | undefined, undefined>").replace("return n.toFixed(0)","const checked: number = n; return String(checked)")
 assert.ok(check(union,{noUncheckedIndexedAccess:true}).some(d=>d.code===2322),"actual payload undefined must survive")
 const regex=block(text,"function digits")
 const diagnostics=check(regex,{noUncheckedIndexedAccess:true})
 assert.ok(diagnostics.length>0)
 assert.ok(diagnostics.every(d=>regex.split("\n")[d.line].includes("reads the source writes keep")),JSON.stringify(diagnostics))
})
test("native optional property types change with project options",()=>{
 const source='export function optional(s: { x?: number }): number { if ("x" in s) return s["x"]; return 0 }'
 assert.ok(check(source).some(d=>d.code===2322))
 assert.deepEqual(check(source,{exactOptionalPropertyTypes:true}),[])
 assert.deepEqual(check(source,{strictNullChecks:false}),[])
 const explicit=source.replace("x?: number","x?: number | undefined")
 assert.ok(check(explicit,{exactOptionalPropertyTypes:true}).some(d=>d.code===2322))
})
