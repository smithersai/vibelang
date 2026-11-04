import assert from "node:assert/strict"
import test from "node:test"
import ts from "typescript"
import fc from "fast-check"
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { chapter, read, tools } from "./spec-witness.mjs"
const writeClauses = [
 "a sidecar found through `include` yields to its source and emit may overwrite it",
 "Listing both the source and its sidecar explicitly in `files` keeps the sidecar as an input",
 "emit reports `TS5055`, exits `1`, and leaves its bytes untouched",
 "The same rule applies in the `vibe.sidecarDir` directory",
 "The required sidecar write is independent of `noEmit` and `declaration: false`",
]
function checkWriteContract(text) {
 for (const clause of writeClauses) assert.ok(text.includes(clause), clause)
}
test("sidecar discovery and explicit input have distinct write contracts",()=>{
 checkWriteContract(chapter("007-tooling"))
 assert.match(read("docs/design/vips/0027-declaration-output.md"),/sidecar is an emit output/)
})
test("fast-check: each discovery, overwrite and independent-write guarantee is required",()=>{
 const text=chapter("007-tooling")
 fc.assert(fc.property(
  fc.integer({min:0,max:writeClauses.length-1}),
  fc.stringMatching(/^[A-Za-z ]{0,50}$/),
  (index,prose)=>{
   checkWriteContract(prose+"\n"+text+"\n"+prose)
   assert.throws(()=>checkWriteContract(text.replace(writeClauses[index],"removed write guarantee")),{code:"ERR_ASSERTION"})
  }),{seed:27027,numRuns:200})
})
test("native TypeScript suppresses discovered sibling declarations and protects explicit inputs",()=>{
 const dir=mkdtempSync(join(tools,".sidecar-input-"))
 try{
  for(const explicit of [false,true]){
   const source=join(dir,"main.ts"),declaration=join(dir,"main.d.ts")
   const original="export declare const value: string; // hand-written\n"
   writeFileSync(source,"export const value = 1;")
   writeFileSync(declaration,original)
   const selection=explicit?{files:["main.ts","main.d.ts"]}:{include:["main.ts","main.d.ts"]}
   const parsed=ts.parseJsonConfigFileContent({compilerOptions:{declaration:true,skipLibCheck:true},...selection},ts.sys,dir)
   assert.equal(parsed.fileNames.includes(declaration),explicit)
   const p=ts.createProgram(parsed.fileNames,parsed.options)
   const result=p.emit()
   const codes=[...ts.getPreEmitDiagnostics(p),...result.diagnostics].map(d=>d.code)
   assert.equal(codes.includes(5055),explicit)
   if(explicit)assert.equal(readFileSync(declaration,"utf8"),original)
   else assert.match(readFileSync(declaration,"utf8"),/value = 1/)
  }
 }finally{rmSync(dir,{recursive:true,force:true})}
})
