import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { inspectInline } from "./inline-module-denial.mjs"
const require=createRequire(new URL("../../runtime/package.json",import.meta.url))
const fc=require("fast-check")
const corpus=JSON.parse(readFileSync(new URL("./property-regressions/alchemy-retired-inline-module.json",import.meta.url),"utf8"))
const raw=process.env.VIBELANG_INLINE_MODULE_RAW==="1"
test("the inline-module oracle quotes denied VIP-25",()=>{
 const vip=readFileSync(new URL("../../../docs/design/vips/0025-inline-modules-denied.md",import.meta.url),"utf8")
 assert.ok(vip.includes("There are no inline "+String.fromCharCode(96)+"module"+String.fromCharCode(96)+" declarations."))
})
function check(input,literal){
 const result=inspectInline(input,literal)
 if(!raw&&corpus.pending.keys.includes(result.key)){
  assert.equal(result.vibe.status,0,"XPASS "+result.key+": review and retire the legacy-module acceptance pending key")
  assert.deepEqual(result.vibe.codes,[],"only the exact erroneous acceptance is pending")
 }else{
  assert.ok(result.vibe.status !== 0 && result.vibe.codes.length > 0,"VIP-25 denies this inline module form; no unpublished diagnostic code is assumed\n"+result.vibe.output)
 }
}
test("alchemy-51: a denied inline module is not a public declaration workaround",()=>check(corpus.input,corpus.source))
test("inline-module rejection covers names, function/const/class exports and their ordinary namespace controls",()=>{
 fc.assert(fc.property(fc.record({name:fc.constantFrom("pem","Legacy","escape"),body:fc.constantFrom("function","const","class")}),check),{seed:510025,numRuns:12,endOnFailure:true})
})
