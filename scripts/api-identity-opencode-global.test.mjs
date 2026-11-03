import assert from "node:assert/strict"
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from "node:fs"
import {tmpdir} from "node:os"
import {join,resolve} from "node:path"
import {test} from "node:test"
import {compareApiIdentity,loadTypeScript} from "./api-identity.mjs"
const versions=[loadTypeScript(),...(process.env.API_IDENTITY_EXTRA_TS?[loadTypeScript([resolve(process.env.API_IDENTITY_EXTRA_TS)])]:[])]
for(const ts of versions)test(`opencode libc augmentation remains identical under TypeScript ${ts.version}`,()=>{
 const root=mkdtempSync(join(tmpdir(),"api-opencode-libc-")),before=join(root,"before"),after=join(root,"after")
 const source='declare global { const FFF_LIBC: "gnu" | "musl"; }\nexport declare const read: () => typeof FFF_LIBC;'
 try{
  for(const dir of [before,after]){
   mkdirSync(dir);writeFileSync(join(dir,"index.d.ts"),source);writeFileSync(join(dir,"package.json"),'{"types":"index.d.ts"}')
   const p=ts.createProgram([join(dir,"index.d.ts")],{strict:true,noEmit:true,types:[],module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler})
   assert.equal(ts.getPreEmitDiagnostics(p).length,0)
  }
  for(const other of [before,after]){
   const r=compareApiIdentity(ts,before,other);assert.equal(r.identical,true,JSON.stringify(r));assert.equal(r.comparisonComplete,true,JSON.stringify(r))
  }
  writeFileSync(join(after,"index.d.ts"),source.replace('"gnu" | "musl"','"windows"'))
  const r=compareApiIdentity(ts,before,after);assert.equal(r.identical,false,JSON.stringify(r));assert.equal(r.comparisonComplete,true,JSON.stringify(r));assert.ok(r.typeDifferences.length,JSON.stringify(r))
 }finally{rmSync(root,{recursive:true,force:true})}
})
