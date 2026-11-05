import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { apiProjection } from "../lib/api-projection.mjs"
import { compareDeclarations } from "../lib/declarations.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-shipped-declaration-alias.json", import.meta.url)))
test("shipped declaration aliases quote the API identity contract", () => {
 assert.ok(readFileSync(SpecPath("001-functions.md"), "utf8").includes(corpus.quote))
})
function witness({ depth=0, extension=".d.ts", reverse=false, mutation="same", integration=false }={}) {
 const root=mkdtempSync(join(tmpdir(),"shipped-declaration-alias-"))
 const logical="src/"+"nested/".repeat(depth)+"index"+extension, stored=".migrate-shipped/"+logical
 const declaration="/** The published value. */\n"+corpus.declaration+"\n"
 const files=reverse?[stored,logical]:[logical,stored]
 const put=(dir,file,text)=>{const path=join(dir,file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text)}
 try {
  const surface={snapshotVersion:3,roots:[logical],reachable:[logical],unresolved:[],resolutions:[],
   apiMetadata:{manifest:{name:"shipped-alias-fixture",type:"module",exports:"./"+logical},packageDir:root,
    aliases:{[logical]:stored},logicalPaths:{[stored]:logical},layouts:[{prefix:"."}]}}
  for(const side of ["before","after"]){
   const dir=join(root,side)
   put(dir,logical,declaration)
   if(mutation!=="missing"||side==="before")put(dir,stored,mutation==="bytes"&&side==="after"?declaration.replace("number","string"):declaration)
   put(dir,"public-surface.json",JSON.stringify(surface))
  }
  const dir=join(root,"after")
  if(mutation==="unrelated"){
   surface.apiMetadata.logicalPaths[stored]="other"+extension
  }
  const projected=()=>apiProjection(ts,dir,surface,mutation==="missing"?[logical]:files)
  if(mutation!=="same"){
   assert.throws(projected,mutation==="missing"?/alias has no stored target/:mutation==="bytes"?/Conflicting declaration snapshot paths/:/Conflicting declaration snapshot alias/)
   return
  }
  const projection=projected()
  try {
   assert.equal(projection.destinations.get(logical),logical)
   assert.equal(projection.destinations.get(stored),logical)
   assert.equal(readFileSync(join(projection.directory,logical),"utf8"),declaration)
   assert.equal(readFileSync(join(dir,logical),"utf8"),declaration)
   assert.equal(readFileSync(join(dir,stored),"utf8"),declaration)
  } finally {projection.cleanup()}
  if(integration){
   for(const [a,b]of [["before","before"],["before","after"]]){
    const result=compareDeclarations(ts,join(root,a),join(root,b))
    assert.equal(result.comparisonComplete,true,JSON.stringify(result))
    assert.equal(result.identical,true,JSON.stringify(result))
   }
  }
 } finally {rmSync(root,{recursive:true,force:true})}
}
test("T3 Code duplicate shipped declarations compare with their original logical owner",()=>witness({integration:true}))
for(const reverse of [false,true])test("explicit logical aliases tolerate duplicate copy order "+reverse,()=>witness({reverse}))
for(const mutation of ["bytes","missing","unrelated"])test("shipped aliases retain "+mutation+" conflicts",()=>witness({mutation}))
test("property: only recorded identical logical owners may share a shipped alias",async()=>{
 await checkProperty(fc,{name:corpus.key,rule:corpus.quote,
 command:"node --test .smithers/flows/migrate/test/shipped-declaration-alias.property.test.mjs",numRuns:80,
 arbitrary:fc.record({depth:fc.integer({min:0,max:3}),extension:fc.constantFrom(".d.ts",".d.mts",".d.cts"),reverse:fc.boolean(),mutation:fc.constantFrom("same","bytes","missing","unrelated")}),check:witness})
})
