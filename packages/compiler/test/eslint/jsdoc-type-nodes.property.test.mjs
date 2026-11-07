import assert from "node:assert/strict"
import {test} from "node:test"
import fc from "fast-check"
import {parse} from "@typescript-eslint/typescript-estree"
import {parseForESLint} from "../../eslint.mjs"
import {plain} from "./helpers.mjs"

const alias=tree=>{
 if(!tree || typeof tree!=="object")return
 if(tree.type==="TSTypeAliasDeclaration")return tree.typeAnnotation
 for(const [key,value] of Object.entries(tree)){
  if(["parent","tokens","comments","loc"].includes(key))continue
  for(const child of Array.isArray(value)?value:[value]){const found=alias(child);if(found)return found}
 }
}
test("JSDoc type operators retain stock TypeScript lint trees and ranges",()=>{
 fc.assert(fc.property(fc.constantFrom("*","?string","!string","string?","string!","?Array<string>","!Array<string>","Array<string>?","Array<string>!","(?string)[]","!(string | number)"),fc.constantFrom(" ","\n","/* 😀 */"),fc.boolean(),(type,gap,body)=>{
  const declaration="type Value"+gap+"="+gap+type+";"
  const source=body?"module text { "+declaration+" }":declaration
  const expected=alias(parse(source,{range:true,comment:true,tokens:true}))
  const actual=alias(parseForESLint(source,{filePath:new URL(body?"./jsdoc.vibe":"./jsdoc.ts",import.meta.url).pathname}).ast)
  assert.deepEqual(plain(actual),plain(expected))
 }),{seed:506017,numRuns:40})
},60_000)

