import assert from "node:assert/strict"
import test from "node:test"
import fc from "fast-check"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
const spec = readFileSync(new URL("../../../docs/design/src/007-tooling.md",import.meta.url),"utf8")

test("sidecar input protection follows native discovery, including no-write controls",()=>{
 assert.ok(spec.includes("compatibility write is independent"))
 assert.ok(spec.includes("explicitly listed in "))
 fc.assert(fc.property(fc.boolean(),fc.boolean(),fc.integer(),fc.constantFrom("alpha","file space","nested"),(explicit,noEmit,value,name)=>{
  const dir=mkdtempSync(join(tmpdir(),"sidecar-input-"))
  try {
   const source=join(dir,name+".ts"),declaration=join(dir,name+".d.ts")
   const original="export declare const n: string; // preserve\\n"
   writeFileSync(source,"export const n="+value+";");writeFileSync(declaration,original)
   const choice=explicit?{files:[name+".ts",name+".d.ts"]}:{include:[name+".ts",name+".d.ts"]}
   const parsed=ts.parseJsonConfigFileContent({compilerOptions:{declaration:true,noEmit,skipLibCheck:true,types:[]},...choice},ts.sys,dir)
   assert.equal(parsed.fileNames.includes(declaration),explicit)
   const p=ts.createProgram(parsed.fileNames,parsed.options),out=p.emit()
   const codes=[...ts.getPreEmitDiagnostics(p),...out.diagnostics].map(d=>d.code)
   assert.equal(codes.includes(5055),explicit&&!noEmit)
   if(explicit||noEmit)assert.equal(readFileSync(declaration,"utf8"),original)
   else assert.match(readFileSync(declaration,"utf8"),new RegExp("n = "+value+";"))
  } finally {rmSync(dir,{recursive:true,force:true})}
 }),{seed:259283,numRuns:12})
})
