import { test } from "node:test"
import { checkRepair, fc, skip } from "./catch-repair-helpers.mjs"
const source = handler => 'export effect function main() { return Effect.fail("bad") catch '+handler+' }\n'
const bridge = 'effect () => try Effect.tryPromise(() => Promise.resolve(7))'
for(const handler of [
  'async function(e:string){return await Promise.resolve(7)}',
  'function*(e:string){yield 1}',
  'async (e:string) => await Promise.resolve(7)',
  'async function*(e:string){yield await Promise.resolve(7)}',
  'async function(e:string){for await (const x of [7]) { return x }}',
  'async () => ({[await Promise.resolve("key")](){return 7}})',
]) test("RC-20 refuses: "+handler,{skip},async t=>{
  await checkRepair(t,source(handler),source(bridge),{refuse:true,sole:handler.includes("function")})
})
for(const handler of [
  'async (e:string) => 7',
  'async (e:string) => { const note="await yield"; /* await yield */ return 7 }',
  'async (e:string) => { const inner=async () => await Promise.resolve(1); return 7 }',
  'async (e:string) => { const inner=function*(){yield 1}; return 7 }',
  'async (e:string) => { const object={async m(){return await Promise.resolve(1)}}; return 7 }',
  'async (e:string) => { class C { async m(){return await Promise.resolve(1)} }; return 7 }',
  'function*(e:string){}',
]) test("RC-20 safe control: "+handler,{skip},async t=>{
  // Function expressions already have an independent runtime parsing gap.
  // Compare the mechanical repair with the identical handwritten function.
  const manual=handler.replace(/^async /,"").replace(/^function\*/,"function")
  await checkRepair(t,source(handler),source(manual))
})
test("RC-20 generated own/nested await and yield",{skip,timeout:240000},async t=>{
  await fc.assert(fc.asyncProperty(fc.constantFrom("await","yield"),fc.boolean(),fc.integer({min:0,max:3}),async(keyword,nested,blocks)=>{
    let statement=keyword==="await"?'await Promise.resolve(7)':blocks%2?'yield* [1,2]':'yield 1'
    for(let i=0;i<blocks;i++) statement='{ '+statement+' }'
    const modifier=keyword==="await"?(blocks%2?"async function*":"async function"):(blocks%2?"async function*":"function*")
    if(nested) {
      const body='(e:string) => { const inner='+modifier+'(){'+statement+'}; return 7 }'
      await checkRepair(t,source("async "+body),source(body))
    } else {
      await checkRepair(t,source(modifier+'(e:string){'+statement+'}'),source(bridge),{refuse:true,sole:true})
    }
  }),{seed:200509,numRuns:12})
})
