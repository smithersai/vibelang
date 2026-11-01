import assert from "node:assert/strict"
import test from "node:test"
import fc from "fast-check"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
const spec = readFileSync(new URL("../../../docs/design/src/007-tooling.md",import.meta.url),"utf8")

test("TypeScript resolves physical or logical sidecar paths before classification",()=>{
 for(const text of ["final resolved path","preserveSymlinks: true","x.d.vibex.ts"]) assert.ok(spec.includes(text),text)
 fc.assert(fc.property(fc.boolean(),fc.constantFrom(".d.vibe.ts",".d.vibex.ts",".d.ts"),fc.constantFrom("Stage","Another"),(preserveSymlinks,extension,name)=>{
  const dir=mkdtempSync(join(tmpdir(),"sidecar-resolve-"))
  try {
   const app=join(dir,"app"),pkg=join(dir,"pkg")
   mkdirSync(join(app,"node_modules"),{recursive:true});mkdirSync(pkg)
   writeFileSync(join(app,"package.json"),'{"type":"module"}')
   writeFileSync(join(app,"main.ts"),"export {}")
   writeFileSync(join(pkg,"package.json"),JSON.stringify({name:"lib",type:"module",exports:{["./"+name]:{types:"./"+name+extension}}}))
   writeFileSync(join(pkg,name+extension),"export declare class Value { private n }")
   symlinkSync(pkg,join(app,"node_modules/lib"),"dir")
   const found=ts.resolveModuleName("lib/"+name,join(app,"main.ts"),{module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,preserveSymlinks},ts.sys).resolvedModule
   assert.ok(found)
   assert.equal(found.resolvedFileName.includes("/node_modules/"),preserveSymlinks)
   assert.equal(found.resolvedFileName,preserveSymlinks?join(app,"node_modules/lib",name+extension):join(pkg,name+extension))
  } finally {rmSync(dir,{recursive:true,force:true})}
 }),{seed:285,numRuns:16})
})
