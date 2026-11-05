import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { test } from "node:test"
import { publishedEntrypoints, compareApiIdentity } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"
const require = createRequire(new URL("../docs/tools/package.json", import.meta.url))
import { createEs5FixtureGuard } from "./testing/fixture-libraries.mjs"
const { ts, assertLibraries } = createEs5FixtureGuard(require("typescript"), "Export-fallback fixtures")
const fc = require("fast-check")
const compilerOptions = { lib: ["lib.es5.d.ts"] }
const nativeOptions = { ...compilerOptions, strict: true, noEmit: true, types: [],
 module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler }
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
 const actual=[...new Set(Object.values(publishedEntrypoints(pkg,ts)))].sort()
 assert.deepEqual(actual,expected,JSON.stringify({targets,actual,expected}))
})}
test("fallback arrays publish only the first resolvable target",()=>check(["./first.d.ts","./second.d.ts"]))
test("missing fallback targets do not become unavailable entry points",()=>check(["./missing.d.ts","./second.d.ts"]))
test("conditional fallback alternatives preserve both import and require surfaces",()=>check([{import:"./first.d.ts"},{require:"./second.d.ts"}]))
test("a resolved types alternative shadows subsequent runtime fallbacks",()=>check([{types:"./first.d.ts"},{import:"./second.d.ts",require:"./third.d.ts"}]))
test("property: ordered fallback discovery agrees with stock tsc resolution",async()=>{
 await checkProperty(fc,{
  name:"api-identity-exports-array-fallback",
  rule:"Names are compared per published entry point. TypeScript resolves an ordered exports fallback rather than publishing every alternative.",
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
  assert.deepEqual([...new Set(Object.values(publishedEntrypoints(pkg,ts)))].sort(),expected)
 })
})

test("unreachable fallback mutations do not alter the compared API; selected mutations fail", () => {
 fixture(["./first.d.ts","./second.d.ts"], (pkg,root) => {
  const after=join(root,"node_modules/after"); cpSync(pkg,after,{recursive:true})
  writeFileSync(join(after,"second.d.ts"),"export type X = number")
  assert.equal(guardedCompare(pkg,after).identical,true)
  nativeIdentity(root,false)
  writeFileSync(join(after,"first.d.ts"),"export type X = number")
  nativeIdentity(root,true)
  const changed=guardedCompare(pkg,after)
  assert.ok(changed.typeDifferences.some(item=>item.export==="X"),JSON.stringify(changed))
 })
})
test("a single fallback and its selected declaration have the same published name", () => {
 fixture(["./first.d.ts"], (pkg,root) => {
  const after=join(root,"node_modules/after"); cpSync(pkg,after,{recursive:true})
  writeFileSync(join(after,"package.json"),JSON.stringify({name:"fixture",exports:{".":"./first.d.ts"}}))
  assert.equal(guardedCompare(pkg,after).identical,true)
 })
})

function guardedCompare(before,after) {
 const result=compareApiIdentity(ts,before,after,{compilerOptions})
 assertLibraries()
 return result
}

function nativeIdentity(root,changed) {
 const consumer=join(root,"consumer.ts")
 writeFileSync(consumer,
  'import type {X as Before} from "fixture"; import type {X as After} from "after";\n'+
  'declare let before:Before; declare let after:After; before=after; after=before;\n')
 const program=ts.createProgram([consumer],nativeOptions)
 assertLibraries()
 assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>d.code),changed?[2322,2322]:[],
  "native consumers retain the selected fallback and reject its changed type")
}

test("export-fallback fixture libraries retain native missing BigInt errors",()=>{
 fixture(["./first.d.ts","./second.d.ts"],(pkg,root)=>{
  writeFileSync(join(pkg,"first.d.ts"),"export type X=BigInt;")
  const program=ts.createProgram([join(pkg,"first.d.ts")],nativeOptions)
  assertLibraries()
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>d.code),[2583])
  const result=guardedCompare(pkg,pkg)
  assert.equal(result.comparisonComplete,false,JSON.stringify(result))
  assert.equal(result.identical,false,JSON.stringify(result))
  assert.ok(result.environmentDiagnostics.some(d=>/TS2583/.test(d.diagnostic)),JSON.stringify(result))
  assert.ok(result.environmentDiagnostics.some(d=>d.blocking&&d.export==="X"&&/unresolved or erroneous/.test(d.diagnostic)),JSON.stringify(result))
 })
})
