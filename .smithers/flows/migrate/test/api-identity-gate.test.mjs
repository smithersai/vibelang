import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { compareDeclarations, recordDeclarationSurface, sidecarChanges } from "../lib/declarations.mjs"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
function fixture(before, after, check, manifests = [{ types: "./index.d.ts" }, { types: "./index.d.ts" }]) {
  const root = mkdtempSync(join(tmpdir(), "migrate-api-gate-"))
  try {
    for (const [i, [side, files]] of Object.entries({ before, after }).entries()) {
      const dir = join(root, side)
      mkdirSync(dir)
      writeFileSync(join(dir, "package.json"), JSON.stringify(manifests[i]))
      for (const [file, text] of Object.entries(files)) {
        mkdirSync(join(dir, file, ".."), { recursive: true })
        writeFileSync(join(dir, file), text)
      }
    }
    return check(join(root, "before"), join(root, "after"))
  } finally { rmSync(root, { recursive: true, force: true }) }
}
function equal(before, after) {
  return fixture(before, after, (a, b) => {
    const r = compareDeclarations(ts, a, b)
    assert.equal(r.identical, true, JSON.stringify(r))
    assert.equal(r.comparisonComplete, true, JSON.stringify(r))
  })
}
test("migration gate accepts formatting, member order and alias expansion", () => {
  equal({
    "index.d.ts": 'import type {Dep} from "./dep.js"; type Text=string; export type X={a:Text;b:Dep}; export {};',
    "dep.d.ts": "export interface Dep { x:number; y:string }",
  }, {
    "index.d.ts": "import {type Dep} from './dep'; export type X = { b: Dep; a: string };",
    "dep.d.ts": "export interface Dep { y:string; x:number }",
  })
})
test("migration gate compares only published exports, including changed private files", () => {
  equal({ "index.d.ts": "export type X=string;", "private.d.ts": "export type Hidden=string;" },
    { "index.d.ts": "export type X=string;", "private.d.ts": "export type Hidden=number;" })
})
test("public entrypoint names cannot change while retaining one declaration filename", () => {
  fixture({ "index.d.ts": "export type X=string;" }, { "index.d.ts": "export type X=string;" }, (a,b) => {
    const r=compareDeclarations(ts,a,b)
    assert.equal(r.identical,false,JSON.stringify(r))
    assert.ok(r.nameDifferences.length,JSON.stringify(r))
  }, [{ exports: { "./first": "./index.d.ts" } }, { exports: { "./second": "./index.d.ts" } }])
})
test("type differences retain the tsc probe diagnostic", () => {
  fixture({ "index.d.ts":"export declare function f(x:string):void;" },
    { "index.d.ts":"export declare function f(x:string|number):void;" }, (a,b) => {
      const r=compareDeclarations(ts,a,b)
      assert.equal(r.identical,false)
      assert.equal(r.comparisonComplete,true,JSON.stringify(r))
      assert.ok(r.typeDifferences.some(d=>/TS2344/.test(d.diagnostic)),JSON.stringify(r))
    })
})
test("JSDoc changes fail, ordinary comments are harmless", () => {
  equal({ "index.d.ts":"/** Stable */ export type X=string;" },
    { "index.d.ts":"// ordinary comment\n/** Stable */ export type X=string;" })
  fixture({ "index.d.ts":"/** Before */ export type X=string;" },
    { "index.d.ts":"/** After */ export type X=string;" }, (a,b)=>{
      const r=compareDeclarations(ts,a,b)
      assert.equal(r.identical,false)
      assert.equal(r.docDifferences.length,1,JSON.stringify(r))
    })
})
test("earlier sidecars preserve JSDoc and use a complete dependency tree", () => {
  const root=mkdtempSync(join(tmpdir(),"migrate-api-sidecar-"))
  try {
    writeFileSync(join(root,"dep.d.ts"),"export interface Dep { value:string }")
    writeFileSync(join(root,"main.d.ts"),'import type {Dep} from "./dep.js";\n/** After */\nexport type X=Dep;')
    const r=sidecarChanges(ts,{"src/main.d.vibe.ts":'import type {Dep} from "./dep.js";\n/** Before */\nexport type X=Dep;'},root)
    assert.deepEqual(r.changed.map(d=>d.file),["src/main.d.vibe.ts"],JSON.stringify(r))
    assert.ok(r.changed[0].docDifferences?.length,JSON.stringify(r))
  } finally { rmSync(root,{recursive:true,force:true}) }
})
test("project snapshots retain source export names, default classes and mts aliases", () => {
  const root=mkdtempSync(join(tmpdir(),"migrate-api-project-"))
  try {
    for(const extension of [".ts",".mts"]){
      const snapshots=[]
      for (const [side,ext] of [["before",extension],["after",".vibe"]]) {
        const pkg=join(root,extension.slice(1),side),out=join(pkg,"decls");snapshots.push(out)
        mkdirSync(join(pkg,"src"),{recursive:true});mkdirSync(out)
        writeFileSync(join(pkg,"src/main"+ext),"export type X=string;")
        writeFileSync(join(pkg,"tsconfig.json"),JSON.stringify({compilerOptions:{rootDir:"src",outDir:"dist",declaration:true},include:["src/**/*"]}))
        const manifest={name:"fixture",type:"module",exports:{"./entry":{types:"./src/main"+ext}}}
        writeFileSync(join(pkg,"package.json"),JSON.stringify(manifest))
        writeFileSync(join(out,ext===".mts"?"main.d.mts":"main.d.ts"),"export type X=string; export declare class Tag<T extends string = \"default\"> { private hidden: T; static label: \"a\" } export default Tag;")
        recordDeclarationSurface(ts,out,pkg,[{tsconfig:"tsconfig.json",prefix:"."}],manifest)
      }
      const r=compareDeclarations(ts,...snapshots)
      assert.equal(r.identical,true,JSON.stringify(r))
      assert.equal(r.comparisonComplete,true,JSON.stringify(r))
      writeFileSync(join(snapshots[1],"main.d.ts"),"export type X=string; export declare class Tag<T extends string = \"default\"> { private hidden: T; static label: \"b\" } export default Tag;")
      const changed=compareDeclarations(ts,...snapshots)
      assert.equal(changed.comparisonComplete,true,JSON.stringify(changed))
      assert.equal(changed.identical,false,JSON.stringify(changed))
      assert.ok(changed.typeDifferences.length,JSON.stringify(changed))
    }
  } finally { rmSync(root,{recursive:true,force:true}) }
})
test("property: migration output rewrites pass and one semantic mutation fails", () => {
  fc.assert(fc.property(fc.boolean(),fc.integer({min:0,max:100}), (reverse,value)=>{
    const fields=[`a:${value}`,"b:string"]
    const before={"index.d.ts":`export type X={${fields.join(";")}};`}
    const after={"index.d.ts":`export type X = { ${(reverse?fields.reverse():fields).join("; ")} };`}
    equal(before,after)
    fixture(before,{"index.d.ts":after["index.d.ts"].replace("b:string","b:boolean")},(a,b)=>{
      const r=compareDeclarations(ts,a,b)
      assert.equal(r.comparisonComplete,true,JSON.stringify(r))
      assert.equal(r.identical,false)
      assert.ok(r.typeDifferences.length,JSON.stringify(r))
    })
  }),{seed:110344,numRuns:4})
})

test("unavailable exported types stay environment failures rather than API differences", () => {
  fixture({"index.d.ts":"export type X=Missing;"},{"index.d.ts":"export type X=Missing;"},(a,b)=>{
    const r=compareDeclarations(ts,a,b)
    assert.equal(r.identical,false)
    assert.equal(r.comparisonComplete,false,JSON.stringify(r))
    assert.deepEqual(r.typeDifferences,[])
    assert.deepEqual(r.changed,[])
    assert.ok(r.environmentDiagnostics.some(d=>d.blocking),JSON.stringify(r))
  })
})

test("stock/native oracle preserves an unavailable result instead of proving every module", async () => {
  const {unprovenDeclarations}=await import("../lib/oracle.mjs")
  fixture({"index.d.ts":"export type X=Missing;"},{"index.d.ts":"export type X=Missing;"},(a,b)=>{
    const r=unprovenDeclarations(ts,a,b)
    assert.equal(r.identical,false)
    assert.match(r.unavailable,/unavailable/i)
    assert.deepEqual(r.changed,[])
  })
})
test("stock/native oracle ignores private layout when its published API is identical", async () => {
  const {unprovenDeclarations}=await import("../lib/oracle.mjs")
  fixture({"index.d.ts":"export type X=string;"},{"index.d.ts":"export type X=string;","private.d.ts":"export type P=number;"},(a,b)=>{
    const r=unprovenDeclarations(ts,a,b)
    assert.equal(r.identical,true,JSON.stringify(r))
    assert.deepEqual(r.files,[])
  })
})

test("legacy snapshots without publishing names are unavailable until setup refreshes them", () => {
  fixture({"index.d.ts":"export type X=string;"},{"index.d.ts":"export type X=string;"},(a,b)=>{
    for(const dir of [a,b]){
      rmSync(join(dir,"package.json"))
      writeFileSync(join(dir,"public-surface.json"),JSON.stringify({snapshotVersion:2,roots:["index.d.ts"],reachable:["index.d.ts"],unresolved:[]}))
    }
    const r=compareDeclarations(ts,a,b)
    assert.equal(r.comparisonComplete,false,JSON.stringify(r))
    assert.deepEqual(r.changed,[])
    assert.match(r.environmentDiagnostics[0].diagnostic,/refresh setup/)
  })
})

test("snapshot dependency aliases preserve export-equals modules", () => {
  const files={"main.d.cts":"declare function make(): string; export = make;",
    "consumer.d.ts":'import make = require("../src/main.cts"); export type Result = ReturnType<typeof make>;'}
  fixture(files,files,(a,b)=>{
    for(const [i,dir] of [a,b].entries()) {
      const manifest={name:"fixture",type:"module",types:i?"./src/consumer.vibe":"./src/consumer.ts"}
      writeFileSync(join(dir,"package.json"),JSON.stringify(manifest))
      writeFileSync(join(dir,"public-surface.json"),JSON.stringify({
        snapshotVersion:3,roots:["consumer.d.ts"],reachable:["consumer.d.ts","main.d.cts"],unresolved:[],
        apiMetadata:{manifest,packageDir:dir,
          aliases:{"src/consumer.ts":"consumer.d.ts","src/consumer.vibe":"consumer.d.ts","src/main.cts":"main.d.cts"},
          logicalPaths:{"main.d.cts":"dist/main.d.cts","consumer.d.ts":"dist/consumer.d.ts"}},
      }))
    }
    const same=compareDeclarations(ts,a,b)
    assert.equal(same.identical,true,JSON.stringify(same))
    writeFileSync(join(b,"main.d.cts"),"declare function make(): number; export = make;")
    const changed=compareDeclarations(ts,a,b)
    assert.equal(changed.comparisonComplete,true,JSON.stringify(changed))
    assert.equal(changed.identical,false,JSON.stringify(changed))
    assert.ok(changed.typeDifferences.length,JSON.stringify(changed))
  })
})

test("an unmapped emitted file uses its project's output layout and native resolution priority", () => {
  fixture({
    "index.d.ts":'export type X=import("./dep").Value;',
    "dep/index.d.ts":"export type Value=string;",
  }, {
    "index.d.ts":'export type X=import("./dep").Value;',
    "dep/index.d.ts":"export type Value=string;",
    "dep.d.ts":"export type Value=number;",
  }, (a,b)=>{
    for(const dir of [a,b]){
      mkdirSync(join(dir,"src/dep"),{recursive:true})
      writeFileSync(join(dir,"src/index.ts"),"export {};")
      writeFileSync(join(dir,"src/dep/index.ts"),"export {};")
      writeFileSync(join(dir,"tsconfig.json"),JSON.stringify({compilerOptions:{rootDir:"src",outDir:"dist"},include:["src/**/*.ts"]}))
      recordDeclarationSurface(ts,dir,dir,[{tsconfig:"tsconfig.json",prefix:"."}],undefined,{handwritten:new Map()})
    }
    const result=compareDeclarations(ts,a,b)
    assert.equal(result.comparisonComplete,true,JSON.stringify(result))
    assert.equal(result.identical,false,JSON.stringify(result))
    assert.ok(result.typeDifferences.some(d=>d.export==="X"),JSON.stringify(result))
    assert.deepEqual(result.added,["dep.d.ts"])
    assert.deepEqual(result.addedPrivate,[])
    assert.ok(result.comparedFiles.before.includes("dep/index.d.ts"),JSON.stringify(result))
    assert.ok(result.comparedFiles.after.includes("dep.d.ts"),JSON.stringify(result))
    assert.ok(!result.comparedFiles.after.includes("dep/index.d.ts"),JSON.stringify(result))
  },[{types:"./dist/index.d.ts"},{types:"./dist/index.d.ts"}])
})

test("earlier sidecars retain recorded output layout and package dependency resolution",()=>{
 const root=mkdtempSync(join(tmpdir(),"migrate-api-sidecar-deps-"))
 try{
  const pkg=join(root,"package"),out=join(root,"snapshot")
  mkdirSync(join(pkg,"src"),{recursive:true});mkdirSync(out)
  mkdirSync(join(pkg,"node_modules/dependency"),{recursive:true})
  writeFileSync(join(pkg,"node_modules/dependency/package.json"),JSON.stringify({types:"index.d.ts"}))
  writeFileSync(join(pkg,"node_modules/dependency/index.d.ts"),"export interface Dep { a:string;b:number }")
  writeFileSync(join(pkg,"package.json"),JSON.stringify({types:"./dist/main.d.ts"}))
  writeFileSync(join(pkg,"tsconfig.json"),JSON.stringify({compilerOptions:{rootDir:"src",outDir:"dist"},include:["src/**/*.ts"]}))
  writeFileSync(join(pkg,"src/main.ts"),"export {};")
  writeFileSync(join(out,"main.d.ts"),'import type {Dep} from "dependency"; export type X={item:Dep};')
  recordDeclarationSurface(ts,out,pkg,[{tsconfig:"tsconfig.json",prefix:"."}])
  const same=sidecarChanges(ts,{"src/main.d.vibe.ts":'import {type Dep} from "dependency"; export type X = { item: Dep };'},out)
  assert.notEqual(same.comparisonComplete,false,JSON.stringify(same))
  assert.deepEqual(same.changed,[])
  const changed=sidecarChanges(ts,{"src/main.d.vibe.ts":'import type {Dep} from "dependency"; export type X={item:Dep;extra:string};'},out)
  assert.notEqual(changed.comparisonComplete,false,JSON.stringify(changed))
  assert.equal(changed.changed.length,1,JSON.stringify(changed))
  assert.ok(changed.changed[0].typeDifferences.length,JSON.stringify(changed))
 }finally{rmSync(root,{recursive:true,force:true})}
})
