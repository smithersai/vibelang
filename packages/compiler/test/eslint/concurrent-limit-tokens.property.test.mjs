import assert from "node:assert/strict"
import {test} from "node:test"
import fc from "fast-check"
import {parse} from "@typescript-eslint/typescript-estree"
import {parseForESLint} from "../../eslint.mjs"

test("concurrency limit tokens retain stock TypeScript lexical kinds",()=>{
 const expression=fc.oneof(fc.integer({min:0,max:4096}).map(String),fc.integer({min:0,max:4096}).map(x=>"0x"+x.toString(16)),fc.integer({min:1,max:4096}).map(x=>"-"+x),fc.constantFrom("1_000","true","false","null",'"four"'))
 fc.assert(fc.property(expression,fc.constantFrom(" ","\n","/* 😀 */"),(value,gap)=>{
  const head="effect function f(xs: number[]) { for concurrent"+gap+"("
  const source=head+value+") (const x of xs) use(x) }"
  const actual=parseForESLint(source,{filePath:new URL("./tokens.vibe",import.meta.url).pathname}).ast.tokens
  const controlHead="const value = "
  const expected=parse(controlHead+value+";",{tokens:true,range:true}).tokens
  const region=(tokens,start)=>tokens.filter(t=>t.range[0]>=start && t.range[1]<=start+value.length).map(t=>({type:t.type,value:t.value,range:t.range.map(n=>n-start)}))
  assert.deepEqual(region(actual,head.length),region(expected,controlHead.length))
 }),{seed:190617,numRuns:30})
},60_000)

