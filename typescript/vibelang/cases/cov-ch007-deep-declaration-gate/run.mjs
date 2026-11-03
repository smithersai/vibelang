// Chapter 007 / deep-declaration-gate: docs/design/src/007-tooling.md#81628d1eb6eafe13
// Chapter 007 / deep-declaration-gate: docs/design/src/007-tooling.md#2da9b0872373803e
// Chapter 007 / deep-declaration-gate: docs/design/src/007-tooling.md#163e5a26d0d027d5
// Chapter 007 / deep-declaration-gate: docs/design/src/007-tooling.md#8975de36eb47c006
import assert from "node:assert/strict"
import {createRequire} from "node:module"
const fc=createRequire(new URL("../../../../docs/tools/package.json",import.meta.url))("fast-check")
import { mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "../../../../docs/tools/node_modules/typescript/lib/typescript.js"
import { compareDeclarations } from "../../../../.smithers/flows/migrate/lib/declarations.mjs"

assert.equal(ts.version, "5.9.3")
const root = fileURLToPath(new URL("./out/deep-gate/", import.meta.url))
rmSync(root, {recursive:true,force:true})
const corpus=JSON.parse(readFileSync(new URL("../../../../packages/compiler/test/corpus/t3code-deep-declaration-gate.json",import.meta.url),"utf8"))
const manifest=corpus.manifest
for (const [name,text] of [["before",corpus.before],["after",corpus.after]]) {
 mkdirSync(join(root,name,"dist"),{recursive:true})
 writeFileSync(join(root,name,"package.json"),JSON.stringify(manifest))
 writeFileSync(join(root,name,"dist/internal.d.ts"),text)
}
mkdirSync(join(root,"consumer/node_modules"),{recursive:true})
symlinkSync(join(root,"before"),join(root,"consumer/node_modules/cli"))
writeFileSync(join(root,"consumer/package.json"),'{"type":"module"}')
const consumer=join(root,"consumer/main.ts")
writeFileSync(consumer,'import type { X } from "cli/dist/internal.js"; export const x: X = "a";')
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,strict:true,noEmit:true,types:[]}
const resolution=ts.resolveModuleName("cli/dist/internal.js",consumer,options,ts.sys).resolvedModule
assert.ok(resolution?.resolvedFileName.endsWith("dist/internal.d.ts"),JSON.stringify(resolution))
assert.deepEqual(ts.getPreEmitDiagnostics(ts.createProgram([consumer],options)).map(d=>d.code),[])
const comparison=compareDeclarations(ts,join(root,"before"),join(root,"after"))
fc.assert(fc.property(fc.constantFrom("internal","nested/type","api/value"),fc.constantFrom("a","b","tool"),(path,name)=>{
 for(const [snapshot,text] of [["before","/** shipped "+name+" */\nexport type X = 'a' | 'b';\n"],["after","export type X = 'b' | 'a';\n"]]){
  const target=join(root,snapshot,"dist",path+".d.ts")
  mkdirSync(join(target,".."),{recursive:true});writeFileSync(target,text)
 }
 const resolved=ts.resolveModuleName("cli/dist/"+path+".js",consumer,options,ts.sys).resolvedModule
 assert.ok(resolved?.resolvedFileName.endsWith("/dist/"+path+".d.ts"))
 const result=compareDeclarations(ts,join(root,"before"),join(root,"after"))
 assert.equal(result.identical,false,"consumer-reachable shipped deep declarations require raw bytes: "+JSON.stringify(result))
}),{seed:7007343,numRuns:12})
assert.equal(comparison.identical,false,"the original minimized witness also requires raw equality")
console.log("ok")
