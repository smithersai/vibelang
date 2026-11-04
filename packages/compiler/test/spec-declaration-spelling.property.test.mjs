// VIP-27 native declaration emit retains written TypeScript specifiers.
// VIP-27 native declaration emit retains written TypeScript specifiers: docs/design/vips/0027-declaration-output.md#c7e3caa9afb8fa5d
// VIP-34 native declaration emit retains written TypeScript specifiers: docs/design/vips/0034-compiler-and-tooling.md#0b9f771c5bbc9e2a
import assert from "node:assert/strict"
import test from "node:test"
import fc from "fast-check"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
const spec = readFileSync(new URL("../../../docs/design/src/001-functions.md",import.meta.url),"utf8")

test("native declarations preserve unrelated written TypeScript specifiers",()=>{
 assert.ok(spec.includes("written `./user.js`, `./App.jsx`, `./user` and native `./plain.ts` keep their spelling."))
 fc.assert(fc.property(fc.constantFrom("helper","file space"),fc.constantFrom("'",'"'),(name,quote)=>{
  const dir=mkdtempSync(join(tmpdir(),"declaration-spelling-"))
  try {
   writeFileSync(join(dir,"main.ts"),"export type { Value } from "+quote+"./"+name+".ts"+quote+";")
   writeFileSync(join(dir,name+".ts"),"export interface Value { n: number }")
   const p=ts.createProgram([join(dir,"main.ts")],{declaration:true,emitDeclarationOnly:true,skipLibCheck:true,types:[],allowImportingTsExtensions:true})
   const emitted=p.emit();assert.deepEqual(emitted.diagnostics,[])
   assert.ok(readFileSync(join(dir,"main.d.ts"),"utf8").includes(quote+"./"+name+".ts"+quote))
  } finally {rmSync(dir,{recursive:true,force:true})}
 }),{seed:263,numRuns:12})
})
