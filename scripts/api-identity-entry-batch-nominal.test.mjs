import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { compareApiIdentity } from "./api-identity.mjs"
const require = createRequire(new URL("../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/opencode-batched-nominal-reexport.json", import.meta.url), "utf8"))
function compare({helper="model.vibe.throwing",batch=1,changed=false}={}) {
  const root=mkdtempSync(join(tmpdir(),"api-batched-nominal-"))
  const body='export declare const Id: unique symbol; export interface Value { readonly [Id]: void; value: string; }'
  const sources={before:{"model.d.ts":body+' export declare const version: number;',"consumer.d.ts":'import type { Value } from "./model.js"; export declare const value: Value;'},after:{"model.d.ts":'export { Id } from "./'+helper+'.js"; export type { Value } from "./'+helper+'.js"; export declare const version: number;',[helper+'.d.ts']:changed?body.replace('value: string','value: number'):body,"consumer.d.ts":'import type { Value } from "./'+helper+'.js"; export declare const value: Value;'}}
  try {
    for(const [side,files] of Object.entries(sources)) {
      const dir=join(root,side);mkdirSync(dir,{recursive:true})
      writeFileSync(join(dir,"package.json"),JSON.stringify({name:"fixture",type:"module",exports:{"./consumer":{types:"./consumer.d.ts"},"./model":{types:"./model.d.ts"}}}))
      for(const [file,text] of Object.entries(files)){mkdirSync(dirname(join(dir,file)),{recursive:true});writeFileSync(join(dir,file),text)}
    }
    return compareApiIdentity(ts,join(root,"before"),join(root,"after"),{entryBatchSize:batch,compilerOptions:{lib:["lib.es5.d.ts"],types:[]}})
  } finally {rmSync(root,{recursive:true,force:true})}
}
const identical=result=>{assert.equal(result.comparisonComplete,true,JSON.stringify(result));assert.equal(result.identical,true,JSON.stringify(result))}
test("one complete batch recognizes a relocated brand reached by another entrypoint",()=>identical(compare({batch:8})))
test("separate batches retain the public identity of a private declaration dependency",()=>identical(compare({batch:1})))
test("every batch size still rejects a public member type mutation",()=>{
  for(const batch of [1,2,8]){const result=compare({batch,changed:true});assert.equal(result.comparisonComplete,true,JSON.stringify(result));assert.equal(result.identical,false);assert.ok(result.typeDifferences.length)}
})
test("property: helper paths and batch sizes cannot change nominal correspondence",()=>{
  assert.ok(readFileSync(new URL("../.smithers/flows/migrate/README.md",import.meta.url),"utf8").includes(corpus.rule))
  fc.assert(fc.property(fc.constantFrom("model.vibe.throwing","private/model","nested/generated/value"),fc.integer({min:1,max:4}),(helper,batch)=>identical(compare({helper,batch}))),{seed:119029,numRuns:16})
})
