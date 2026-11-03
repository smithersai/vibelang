import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"
import { withPackingScope } from "../lib/pack-policy.mjs"
import { foreignChanges } from "../lib/touched.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const fc=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))("fast-check")
const rule="Only recorded packing changes belong to the batch; ownership survives re-emission, restart and restore."
const paths=id=>["package.json",".npmignore",".vibelang/pack-policy.json"].map(file=>"packages/p"+id+"/"+file)

function trace(phases) {
 let journal={batch:"01",marker:"retained",emittedJs:[]}
 const expected=new Set()
 for(const phase of phases){
  const emitted=phase.ids.map(id=>({package:"packages/p"+id,packingFiles:paths(id),restored:phase.stage==="restore"}))
  for(const id of phase.ids)for(const file of paths(id))expected.add(file)
  journal=JSON.parse(JSON.stringify(withPackingScope(journal,emitted)))
  assert.equal(journal.marker,"retained")
  assert.deepEqual(withPackingScope(journal,[]),journal,"no new policy is an idempotent restart")
  // The latest emission can disappear after a revert. Its durable ownership
  // must still cover deletions, without admitting neighboring source edits.
  journal.emittedJs=[]
  const own=[...expected].map(path=>({status:phase.stage==="restore"?"D":"A",path}))
  const foreign=[
   {status:"M",path:"packages/foreign/.npmignore"},
   {status:"M",path:"packages/p0/src/unselected.vibe"},
   {status:"A",path:"packages/p0/.vibelang/private-cache.json"}
  ]
  assert.deepEqual(foreignChanges([...own,...foreign],{files:[],codemod:journal}),foreign)
 }
}
test("opencode: packing first written during verify remains owned after later empty and restore phases",()=>trace([
 {stage:"codemod",ids:[]},{stage:"verify",ids:[0]},{stage:"record",ids:[]},{stage:"restore",ids:[0]},{stage:"verify",ids:[]}
]))
test("legacy emitted receipts seed durable packing ownership without dropping journal fields",()=>{
 const journal=withPackingScope({batch:"01",emittedJs:[{packingFiles:paths(2)}]},[])
 assert.deepEqual(journal.packingFiles,paths(2).sort())
 assert.equal(journal.batch,"01")
 assert.equal(withPackingScope(undefined,[]),undefined)
})
test("property: exact packing ownership survives arbitrary phase histories and journal reloads",async()=>{
 await checkProperty(fc,{name:"packing-phase-scope",rule,command:"node --test test/packing-scope.property.test.mjs",
  arbitrary:fc.array(fc.record({stage:fc.constantFrom("codemod","verify","record","restore"),ids:fc.uniqueArray(fc.integer({min:0,max:4}),{maxLength:5})}),{minLength:1,maxLength:20}),
  check:trace,numRuns:200,regressions:new URL("./corpus/",import.meta.url)})
})
