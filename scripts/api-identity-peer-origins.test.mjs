import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/alchemy-peer-ambient-context.json",import.meta.url)))
const ts = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const options = { strict:true,noEmit:true,types:[],module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,target:ts.ScriptTarget.ESNext }
function verify({ count = 3, tag = 1 } = {}) {
  const root=mkdtempSync(join(tmpdir(),"api-peer-origins-")),before=join(root,"before"),after=join(root,"after")
  const peerFile=(dir,i)=>join(dir,`node_modules/.pnpm/peer-lib@1.0.0_peer@${i+1}.0.0/node_modules/peer/index.d.ts`)
  const put=(file,text)=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text)}
  try {
    for(const dir of [before,after]){
      const imports=[]
      for(let i=0;i<count;i++){
        const base=`node_modules/.pnpm/peer-lib@1.0.0_peer@${i+1}.0.0/node_modules`
        put(join(dir,base,"peer-lib/package.json"),JSON.stringify(corpus.libraryManifest))
        put(join(dir,base,"peer-lib/index.d.ts"),corpus.libraryDeclaration)
        put(join(dir,base,"peer/package.json"),JSON.stringify({name:"peer",version:`${i+1}.0.0`,types:"index.d.ts"}))
        put(peerFile(dir,i),`export interface Context { tag: ${tag+i} }`)
        imports.push(`import type {Value as V${i}} from "./${base}/peer-lib";`)
      }
      put(join(dir,"index.d.ts"),imports.join("\n")+`\nexport type Result = [${Array.from({length:count},(_,i)=>`V${i}`).join(",")}]; export type Distinct = V0 extends V1 ? false : true;`)
      put(join(dir,"package.json"),'{"types":"index.d.ts"}')
      const p=ts.createProgram([join(dir,"index.d.ts")],options),ds=ts.getPreEmitDiagnostics(p)
      assert.equal(ds.length,0,ts.formatDiagnostics(ds,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>dir,getNewLine:()=>"\n"}))
      const c=p.getTypeChecker(),symbol=c.getExportsOfModule(c.getSymbolAtLocation(p.getSourceFile(join(dir,"index.d.ts")))).find(s=>s.name==="Distinct")
      assert.equal(c.typeToString(c.getDeclaredTypeOfSymbol(symbol)),"true","peer contexts must retain distinct nominal types")
    }
    for(const other of [before,after]){
      const r=compareApiIdentity(ts,before,other)
      assert.equal(r.comparisonComplete,true,JSON.stringify(r));assert.equal(r.identical,true,JSON.stringify(r))
    }
    put(peerFile(after,0),`export interface Context { tag: ${tag+100} }`)
    const changed=compareApiIdentity(ts,before,after)
    assert.equal(changed.identical,false,JSON.stringify(changed))
    assert.ok(changed.typeDifferences.length||changed.environmentDiagnostics.some(d=>d.blocking),JSON.stringify(changed))
  }finally{rmSync(root,{recursive:true,force:true})}
}
test("pnpm peer-qualified ambient packages compare with themselves and copied installs",()=>verify())
test("property: peer contexts retain self identity without hiding a changed peer",async()=>{
  await checkProperty(fc,{name:"api-identity-peer-ambient-origins",rule:"Will: a tree compared with itself must be identical; distinct peer resolutions stay separate and real API differences must not be hidden.",command:"node --test scripts/api-identity-peer-origins.test.mjs",arbitrary:fc.record({count:fc.integer({min:2,max:3}),tag:fc.integer({min:-10,max:10})}),numRuns:12,check:verify})
})
