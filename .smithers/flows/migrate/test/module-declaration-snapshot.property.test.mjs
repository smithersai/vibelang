import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { recordDeclarationSurface, compareDeclarations } from "../lib/declarations.mjs"
const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-module-declaration-snapshot.json", import.meta.url)))
const specification = readFileSync(new URL("../../../../docs/design/src/007-tooling.md", import.meta.url),"utf8")
const put=(root,file,text)=>{const p=join(root,file);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,text)}
function witness({ext="vibe",body="platform",nested=false,changed=false,orphan=false,orphanChanged=changed}={}) {
 const temporary=mkdtempSync(join(tmpdir(),"module-companion-snapshot-")),root=join(temporary,"package")
 try {
  const dir=nested?"src/nested":"src",stem=dir+"/main",source=stem+"."+ext
  const encoded=[...body].map(c=>/^[a-z0-9_]$/.test(c)?c:"-"+c.codePointAt(0).toString(16)+"-").join("")
  const companion=source+"."+encoded+".d.ts",extra=source+".orphan.d.ts"
  const manifest={name:"fixture",type:"module",types:"./"+stem+".d.ts",...(orphan?{exports:{".":{types:"./"+stem+".d.ts"},"./extra":{types:"./"+extra}}}:{})}
  put(root,"package.json",JSON.stringify(manifest))
  put(root,"tsconfig.json",JSON.stringify({compilerOptions:{rootDir:".",strict:true,target:"ESNext",module:"NodeNext",moduleResolution:"NodeNext"},files:[source]}))
  put(root,source,corpus.source.replaceAll("platform",body))
  put(root,companion,corpus.stale)
  if(orphan)put(root,extra,"export interface Extra { value: number }\n")
  for(const side of ["before","after"]){
   const snapshot=join(temporary,side)
   const value=changed&&side==="after"?"string":"number"
   put(snapshot,stem+".d.ts",corpus.entry.replace("main.vibe.platform","main."+ext+"."+encoded))
   put(snapshot,companion,corpus.fresh.replace("number",value))
   if(orphan)put(root,extra,"export interface Extra { value: "+(orphanChanged&&side==="after"?"string":"number")+" }\n")
   const surface=recordDeclarationSurface(ts,snapshot,root,[{tsconfig:"tsconfig.json",prefix:"."}])
   assert.equal(surface.apiMetadata.aliases[companion],companion)
   assert.equal(surface.apiMetadata.logicalPaths[companion],companion)
   assert.equal(readFileSync(join(root,companion),"utf8"),corpus.stale)
   assert.ok(!surface.apiMetadata.aliases[companion].startsWith(".migrate-shipped/"))
   if(orphan)assert.equal(surface.apiMetadata.aliases[extra],".migrate-shipped/"+extra)
  }
  const result=compareDeclarations(ts,join(temporary,"before"),join(temporary,"after"))
  assert.equal(result.comparisonComplete,true,JSON.stringify(result.environmentDiagnostics))
  assert.equal(result.identical,!(changed||orphan&&orphanChanged),JSON.stringify({names:result.nameDifferences,types:result.typeDifferences,docs:result.docDifferences}))
 } finally {rmSync(temporary,{recursive:true,force:true})}
}
test("native module declaration snapshots retain their emitted owner",()=>{assert.ok(specification.includes(corpus.quote));witness()})
test("changed module body API stays different",()=>witness({changed:true}))
test("unowned declaration neighbours retain their handwritten snapshot",()=>witness({orphan:true,orphanChanged:true}))
test("module declaration snapshot neighbourhood",()=>{
 fc.assert(fc.property(fc.record({ext:fc.constantFrom("vibe","vibex"),body:fc.constantFrom("platform","NativeIO","$host","λ"),nested:fc.boolean(),changed:fc.boolean(),orphan:fc.boolean(),orphanChanged:fc.boolean()}),witness),{seed:400127,numRuns:32,endOnFailure:true})
})

