import assert from "node:assert/strict"
import test from "node:test"
import ts from "typescript"
import { chapter, read, tools } from "./spec-witness.mjs"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
test("service signatures state the native implicit-any rule",()=>{
 const text=chapter("005-services")
 for(const s of ["an omitted type follows TypeScript's `noImplicitAny`","TS7010","TS7008","VibeLang adds no diagnostic of its own"]) assert.ok(text.includes(s),s)
 assert.match(read("docs/design/vips/0009-service-declarations.md"),/omitted member types/)
})
test("native bodyless method and property options follow the printed interface counterpart",()=>{
 const directory=mkdtempSync(join(tools,".service-any-"))
 try{
  for(const explicit of [false,true]){
   const file=join(directory,"shape.ts")
   writeFileSync(file,explicit?"interface Reader { read(): any; value: any }":"interface Reader { read(); value }")
   for(const noImplicitAny of [false,true]){
    const p=ts.createProgram([file],{strict:true,noImplicitAny,noEmit:true,skipLibCheck:true})
    const codes=ts.getPreEmitDiagnostics(p).filter(d=>d.file?.fileName===file).map(d=>d.code).sort()
    assert.deepEqual(codes,explicit||!noImplicitAny?[]:[7008,7010])
   }
  }
 }finally{rmSync(directory,{recursive:true,force:true})}
})
