import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { test } from "node:test"
import { publishedEntrypoints, compareApiIdentity } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"
const require = createRequire(new URL("../docs/tools/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
function fixture(targets, run) {
 const root=mkdtempSync(join(tmpdir(),"api-identity-fallback-"))
 const pkg=join(root,"node_modules/fixture")
 try {
  mkdirSync(pkg,{recursive:true})
  for(const name of ["first","second","third"]) writeFileSync(join(pkg,name+".d.ts"),"export type X = string")
  writeFileSync(join(pkg,"package.json"),JSON.stringify({name:"fixture",exports:{".":targets}}))
  return run(pkg,root)
 } finally {rmSync(root,{recursive:true,force:true})}
}
function oracle(pkg,root,mode) {
 return ts.resolveModuleName("fixture",join(root,"consumer.ts"),{
  module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler
 },ts.sys,undefined,undefined,mode).resolvedModule?.resolvedFileName
}
function check(targets) { fixture(targets,(pkg,root)=>{
 const expected=[...new Set([ts.ModuleKind.ESNext,ts.ModuleKind.CommonJS].map(mode=>oracle(pkg,root,mode)).filter(Boolean))].sort()
 const actual=[...new Set(Object.values(publishedEntrypoints(pkg)))].sort()
 assert.deepEqual(actual,expected,JSON.stringify({targets,actual,expected}))
})}
test("fallback arrays publish only the first resolvable target",()=>check(["./first.d.ts","./second.d.ts"]))
test("missing fallback targets do not become unavailable entry points",()=>check(["./missing.d.ts","./second.d.ts"]))
test("conditional fallback alternatives preserve both import and require surfaces",()=>check([{import:"./first.d.ts"},{require:"./second.d.ts"}]))
test("a resolved types alternative shadows subsequent runtime fallbacks",()=>check([{types:"./first.d.ts"},{import:"./second.d.ts",require:"./third.d.ts"}]))
test("property: ordered fallback discovery agrees with stock tsc resolution",async()=>{
 await checkProperty(fc,{
  name:"api-identity-exports-array-fallback",
  rule:"Will: names are compared per published entrypoint. TypeScript resolves an ordered exports fallback rather than publishing every alternative.",
  command:"node --test scripts/api-identity-exports-fallback.test.mjs",
  arbitrary:fc.record({missing:fc.boolean(),reverse:fc.boolean(),typed:fc.boolean()}),
  numRuns:24,
  check:({missing,reverse,typed})=>{
   const good=reverse?["./second.d.ts","./first.d.ts"]:["./first.d.ts","./second.d.ts"]
   const targets=missing?["./missing.d.ts",...good]:good
   check(typed?targets.map(types=>({types})):targets)
  }
 })
})

test("nested custom condition paths retain their first resolvable fallback", () => {
 fixture([{browser:{development:"./first.d.ts"}},"./second.d.ts"], (pkg,root) => {
  const expected = [...new Set([[],["browser","development"]].map(customConditions =>
   ts.resolveModuleName("fixture",join(root,"consumer.ts"), {
    module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,customConditions
   },ts.sys).resolvedModule?.resolvedFileName).filter(Boolean))].sort()
  assert.deepEqual([...new Set(Object.values(publishedEntrypoints(pkg)))].sort(),expected)
 })
})

test("unreachable fallback mutations do not alter the compared API; selected mutations fail", () => {
 fixture(["./first.d.ts","./second.d.ts"], (pkg,root) => {
  const after=join(root,"node_modules/after"); cpSync(pkg,after,{recursive:true})
  writeFileSync(join(after,"second.d.ts"),"export type X = number")
  assert.equal(compareApiIdentity(ts,pkg,after).identical,true)
  writeFileSync(join(after,"first.d.ts"),"export type X = number")
  const changed=compareApiIdentity(ts,pkg,after)
  assert.ok(changed.typeDifferences.some(item=>item.export==="X"),JSON.stringify(changed))
 })
})
test("a single fallback and its selected declaration have the same published name", () => {
 fixture(["./first.d.ts"], (pkg,root) => {
  const after=join(root,"node_modules/after"); cpSync(pkg,after,{recursive:true})
  writeFileSync(join(after,"package.json"),JSON.stringify({name:"fixture",exports:{".":"./first.d.ts"}}))
  assert.equal(compareApiIdentity(ts,pkg,after).identical,true)
 })
})
