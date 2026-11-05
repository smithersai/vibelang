import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { originalFunctions, runPhaseOf, blocking, runPhaseChanges, vibeTree } from "../lib/run-phase.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
const require=createRequire(new URL("../../../../docs/tools/package.json",import.meta.url))
const ts=require("typescript"),fc=require("fast-check")
const corpus=JSON.parse(readFileSync(new URL("./corpus/alchemy-eager-streaming-decoder.json",import.meta.url)))
const phase=(source,path="make")=>{
 const slot=originalFunctions(ts,source).get(path)
 assert.ok(slot?.node,path)
 return runPhaseOf(ts,slot.node)
}
test("eager constructor arguments quote migration preservation",()=>{
 assert.ok(readFileSync(SpecPath("007-tooling.md"),"utf8").includes(corpus.quote))
})
test("Alchemy streaming decoder stays at its returned plain function's call",()=>{
 const result=phase(corpus.original,"make/return")
 assert.equal(result.verdict,"eager",JSON.stringify(result))
 assert.equal(blocking(result),true)
 assert.match(result.detail,/decoder\.decode/)
})
const work=["decoder.decode(chunk,{stream:true})","decoder.value","decoder[key]","++count","count++","(count=1)","new Uint8Array(1)","{...decoder}","[...chunk]"]
const wrap=(value,n)=>n===0?value:n===1?"("+value+")":n===2?"("+value+" as any)":"("+value+" satisfies any)"
function witness({operation="succeed",argument=work[0],style="arrow",curried=false,alias=false,wrapping=0}={}){
 const member=alias?"FX":"Effect"
 const body=member+"."+operation+"("+wrap(argument,wrapping)+")"
 const fn=style==="arrow"?"(chunk:any)=>"+body:style==="block"?"(chunk:any)=>{return "+body+";}":"function(chunk:any){return "+body+";}"
 const source='import { Effect'+(alias?' as FX':'')+' } from "effect"; declare const decoder:any,key:any; declare let count:number; export const make='+(curried?"(decoder:any)=>":"")+fn+";"
 const result=phase(source,curried?"make/return":"make")
 assert.equal(result.verdict,"eager",JSON.stringify({source,result}))
 assert.equal(blocking(result),true)
 assert.match(result.detail,/at the call:/)
}
for(const operation of ["succeed","fail","die"])test("strict "+operation+" arguments retain eager decoder work",()=>witness({operation}))
test("property: strict constructor argument work remains at every original call",async()=>{
 await checkProperty(fc,{name:corpus.key,rule:corpus.quote,
 command:"node --test .smithers/flows/migrate/test/eager-constructor-arguments.property.test.mjs",numRuns:120,
 arbitrary:fc.record({operation:fc.constantFrom("succeed","fail","die"),argument:fc.constantFrom(...work),style:fc.constantFrom("arrow","block","function"),curried:fc.boolean(),alias:fc.boolean(),wrapping:fc.integer({min:0,max:3})}),check:witness})
})
test("thunks, literals and opaque factories keep conservative nonblocking controls",()=>{
 const expressions=[
 "Effect.succeed(value)","Effect.succeed(1)","Effect.succeed(()=>decoder.decode(chunk))",
 "Effect.succeed({decode(){return decoder.decode(chunk)}})","Effect.sync(()=>decoder.decode(chunk))",
 "Effect.try(()=>decoder.decode(chunk))","Effect.gen(function*(){return decoder.decode(chunk)})","helper(value)"
 ]
 for(const expression of expressions){
  const result=phase('import { Effect } from "effect";export const make=()=>'+expression)
  assert.equal(blocking(result),false,JSON.stringify({expression,result}))
 }
})
test("unproven and optional constructors remain conservative",()=>{
 for(const source of [
  'export const make=(Effect:any)=>Effect.succeed(decoder.decode(chunk))',
  'import {Effect} from "other";export const make=()=>Effect.succeed(decoder.decode(chunk))',
  'import {Effect} from "effect";export const make=()=>Effect.succeed?.(decoder.decode(chunk))'
 ])assert.equal(phase(source).verdict,"review")
})
test("the batch check blocks the minimized retimed decoder",()=>{
 const compiler=process.env.VIBELANG_COMPILER??fileURLToPath(new URL("../../../../packages/compiler/native/vibelang",import.meta.url))
 assert.ok(existsSync(compiler),"build the native compiler before checking the decoder pair")
 const changes=runPhaseChanges({ts,original:corpus.original,originalPath:"decoder.ts",
  vibe:vibeTree(compiler,corpus.retimed,"decoder.vibe"),vibeText:corpus.retimed})
 assert.deepEqual(changes.filter(blocking).map(({name,verdict})=>({name,verdict})),[{name:"make/return",verdict:"eager"}])
})
