import { test } from "node:test"
import { checkRepair, callableSource, fc, skip } from "./catch-repair-helpers.mjs"

const witnesses = [
  "make(e,error,failure,$e)",
  '({get:make(e,error,failure,$e)})["get"]',
  'make("","","",/* e error failure */ $e)',
  'make("","","",\\u0065)',
  'make("","","",\\u{65})',
  'make("","","","outer")',
]
for(const handler of witnesses) test("RC-22: "+handler,{skip},async t=>{
  await checkRepair(t,callableSource(handler),callableSource("(caught) => ("+handler+")(caught)"))
})
test("RC-22: generated outer reads, suffix collisions, escaped names and comments",{skip,timeout:240000},async t=>{
  await fc.assert(fc.asyncProperty(
    fc.constantFrom("e","error","failure","$e","\\u0065","\\u{65}"),
    fc.integer({min:0,max:8}), fc.boolean(), fc.boolean(), fc.string({maxLength:8}),
    async (name,count,computed,withComment,value)=>{
      const extra=Array.from({length:count},(_,i)=>", $e"+(i+2)+'="suffix"').join("")
      const handler='make('+(withComment?'/* e error failure $e 😀 */ ':'')+'"", "", "", '+name+')'
      const expression=computed?'({get:'+handler+'})["get"]':handler
      const declarations='const e='+JSON.stringify(value)+', error="R", failure="F", $e="outer"'+extra
      await checkRepair(t,callableSource(expression,declarations),callableSource("(caught) => ("+expression+")(caught)",declarations))
    }
  ),{seed:220509,numRuns:16})
})
