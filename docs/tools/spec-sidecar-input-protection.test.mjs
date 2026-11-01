import assert from "node:assert/strict"
import test from "node:test"
import ts from "typescript"
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { chapter, read, tools } from "./spec-witness.mjs"
test("sidecar discovery and explicit input have distinct write contracts",()=>{
 const text=chapter("007-tooling")
 for(const s of ["TS5055","exits `1`","explicitly listed in `files`","compatibility write is independent","noEmit: true","declaration: false"]) assert.ok(text.includes(s),s)
 assert.match(read("docs/design/vips/0027-declaration-output.md"),/sidecar is an emit output/)
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
