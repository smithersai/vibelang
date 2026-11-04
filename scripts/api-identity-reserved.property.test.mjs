// Smithers flow/Deferred publishes await as an alias. A declaration probe
// must use a legal local alias and still detect actual changes to that export.
import assert from "node:assert/strict"
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {createRequire} from "node:module"
import {test} from "node:test"
import {compareApiIdentity,loadTypeScript} from "./api-identity.mjs"
const ts=loadTypeScript()
const fc=createRequire(new URL("../docs/tools/package.json",import.meta.url))("fast-check")
const corpus=JSON.parse(readFileSync(new URL("./api-identity-corpus/smithers-flow-await.json",import.meta.url),"utf8"))
function check({keyword,depth,changed=false}){
 const dir=mkdtempSync(join(tmpdir(),"api-keyword-"))
 try{
  for(const side of ["before","after"]){
   const root=join(dir,side);mkdirSync(root)
   const local=side==="before"?"originalAwait":"renamedAwait"
   const result=changed&&side==="after"?"string":"number"
   const leaf="declare function "+local+"<A>(value:A):"+result+";\nexport { "+local+" as "+JSON.stringify(keyword)+" };\n"
   writeFileSync(join(root,"leaf.d.ts"),leaf)
   let last="leaf"
   for(let i=0;i<depth;i++){
    const name="level"+i
    writeFileSync(join(root,name+".d.ts"),'export * as Box from "./'+last+'.js";\n')
    last=name
   }
   writeFileSync(join(root,"index.d.ts"),depth?'export * from "./'+last+'.js";\n':leaf)
   writeFileSync(join(root,"package.json"),JSON.stringify({name:"@demo/flow",type:"module",types:"./index.d.ts"}))
  }
  const r=compareApiIdentity(ts,join(dir,"before"),join(dir,"after"))
  assert.equal(r.comparisonComplete,true,JSON.stringify(r))
  assert.equal(r.identical,!changed,JSON.stringify(r))
  if(changed)assert(r.typeDifferences.length,JSON.stringify(r))
 }finally{rmSync(dir,{recursive:true,force:true})}
}
test("Smithers await export: top-level alias and namespace re-export compare completely",()=>{
 check(corpus)
 check({...corpus,depth:1})
 check({...corpus,depth:2})
})
test("reserved export aliases still reject changed return types",()=>{
 check({...corpus,changed:true})
 check({...corpus,depth:1,changed:true})
})
test("keyword exports preserve alias identity through namespace depth and retain negative controls",()=>{
 fc.assert(fc.property(fc.record({keyword:fc.constantFrom("await","yield","default","class","function","new"),depth:fc.integer({min:0,max:2}),changed:fc.boolean()}),check),{seed:20261104,numRuns:24})
})
