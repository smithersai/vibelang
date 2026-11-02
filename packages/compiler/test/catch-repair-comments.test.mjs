import assert from "node:assert/strict"
import { test } from "node:test"
import { checkRepair, fc, skip } from "./catch-repair-helpers.mjs"
const source = (handler,declarations='') => declarations+'export effect function main() { return Effect.fail("bad") catch '+handler+' }\n'
async function checkComments(t,written,manual,declarations="") {
  const text=await checkRepair(t,source(written,declarations),source(manual,declarations),{sole:written.includes("function")})
  // These templates have fixed string literals. Together with exact comment
  // comparison and successful compilation, this pins every body token too.
  assert.equal(text.replace(/\s+/gu,""),source(manual,declarations).replace(/\s+/gu,""),"modifier repair changed the body")
}
for(const handler of [
  'async /* KEEP_HEADER */ (e:string) => 7',
  'async /* KEEP_ONE */ /* KEEP_TWO */ (e:string) => 7',
  'async /** KEEP_DOC */ function(e:string){return 7}',
  'async /* BEFORE_STAR */ function /* BEFORE_ASTERISK */ * /* AFTER_STAR */ (e:string){const preserved=7}',
  'async /* HEADER */ function /* LINE\nBREAK */ * (e:string){const preserved=7}',
]) test("RC-21: "+handler,{skip},async t=>{
  await checkComments(t,handler,handler.replace(/^async /,"").replace("* /* AFTER_STAR */"," /* AFTER_STAR */").replace("* (e:string)"," (e:string)"))
})
test("RC-21 generated modifier/comment placements",{skip,timeout:240000},async t=>{
  await fc.assert(fc.asyncProperty(fc.constantFrom("/* keep 😀 */","/** keep doc */","/* e error failure $e */"),fc.constantFrom(" ","\t","  "),fc.constantFrom("arrow","function","generator","async-generator"),fc.constantFrom("e","$e","\\u0065","\\u{65}"),async(comment,space,shape,outer)=>{
    const generator=shape.includes("generator"), hasAsync=shape!=="generator"
    const suffix=shape==="arrow"?'(caught:string) => '+outer:'function'+(generator?'*':'')+' /* keep star */ (caught:string){'+(generator?'const preserved='+outer:'return '+outer)+'}'
    const written=(hasAsync?'async'+space+comment+space:'')+suffix
    const manual=(hasAsync?comment+space:'')+suffix.replace("function*","function")
    await checkComments(t,written,manual,'const e="outer E", $e="outer dollar"\n')
  }),{seed:210509,numRuns:12})
})
