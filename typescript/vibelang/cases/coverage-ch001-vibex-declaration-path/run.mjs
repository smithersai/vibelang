// run-seconds: 300
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { project,check,nativeCheck,run,codes,stock,repo } from "../../tests/coverage-tooling.mjs"

for(const [jsx,extension] of [["preserve",".jsx"],["react-jsx",".js"]]) {
 const p=project(import.meta.url,"vibe-"+jsx,{"main.vibe":'export { App } from "./App.vibex"',"App.vibex":"export const App=7"}, {compilerOptions:{module:"ESNext",moduleResolution:"Bundler",jsx,noEmit:false,declaration:true,allowArbitraryExtensions:true,rewriteRelativeImportExtensions:true}})
 const actual=check(p)
 const native=project(import.meta.url,"native-"+jsx,{"main.ts":'export { App } from "./App'+extension+'"',"App.tsx":"export const App=7"}, {compilerOptions:{module:"ESNext",moduleResolution:"Bundler",jsx,noEmit:false,declaration:true,allowArbitraryExtensions:true,rewriteRelativeImportExtensions:true}})
 const reference=nativeCheck(native)
 assert.equal(reference.status,0,reference.output)
 assert.equal(actual.status,0,actual.output)
 assert.equal(p.read("build/main.d.ts").trim(),native.read("build/main.d.ts").trim())
 assert.ok(fs.existsSync(path.join(p.dir,"build","App"+extension)))
}

// Spec rule: docs/design/src/001-functions.md#ee61d9a503677298
// Chapter 001: declaration-path.
console.log("coverage-ok")
