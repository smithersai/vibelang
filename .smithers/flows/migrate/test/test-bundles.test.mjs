import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import { test } from "node:test"
import { buildInventory } from "../lib/inventory.mjs"
import { candidates, draftPlan, validatePlan } from "../lib/plan.mjs"
import { planScope, onePassStep } from "../lib/onepass.mjs"
import { codemod, paths } from "../lib/steps.mjs"
import { testBundleDeferrals } from "../lib/test-bundles.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-test-owned-bundle-graph.json", import.meta.url)))
function fixture() {
  const base = mkdtempSync(join(tmpdir(), "alchemy-test-bundles-")), root = join(base, "repo")
  const put = (file, text) => { mkdirSync(dirname(join(root,file)), {recursive:true}); writeFileSync(join(root,file),text) }
  put("package.json", JSON.stringify({private:true,workspaces:["packages/*"]}))
  for (const name of ["cloudflare","sql","integration-tests"]) put("packages/"+name+"/package.json", JSON.stringify({
    name:"@alchemy.run/"+name, exports:{"./*":{types:"./lib/*.d.ts",default:"./src/*.ts"}}
  }))
  for (const [file,text] of Object.entries(corpus.files)) put(file,text)
  put(corpus.test,corpus.source)
  const packages = ["cloudflare","sql"].map(name=>({dir:"packages/"+name,sources:["src"]}))
  return {root,base,put,packages,inventory() {return buildInventory({root,packages})},dispose(){rmSync(base,{recursive:true,force:true})}}
}

test("alchemy: inventory and default plans retain the whole graph bundled by an unchanged test", () => {
  const f = fixture()
  try {
    const inventory = f.inventory()
    const retained = inventory.files.filter(file=>file.bundledBy?.length).map(file=>file.path).sort()
    assert.deepEqual(retained,corpus.retained)
    assert.deepEqual(candidates(inventory).map(file=>file.path),["packages/sql/src/Free.ts"])
    for (const file of inventory.files.filter(file=>file.bundledBy?.length)) {
      assert.equal(file.bundledBy[0].test,corpus.test)
      assert.equal(file.bundledBy[0].entry,"packages/cloudflare/src/Workers/SqlMigrationsApply.ts")
      assert.equal(file.bundledBy[0].bundler,"rolldown")
      assert.ok(file.bundledBy[0].line>0)
    }
    assert.deepEqual(draftPlan(inventory).deferred.map(d=>d.file).sort(),corpus.retained)
    assert.equal(readFileSync(join(f.root,corpus.test),"utf8"),corpus.source)
  } finally {f.dispose()}
})

test("explicit and one-pass plans preserve test bundle deferrals", () => {
  const f = fixture()
  try {
    const inventory=f.inventory()
    const proposed={batches:[{files:[corpus.retained[0]],reason:"explicit scope"}]}
    assert.ok(validatePlan(proposed,inventory).errors.some(e=>e.includes("test-owned bundle")))
    const plan=planScope(f.root,Object.keys(corpus.files))
    assert.deepEqual(plan.batches[0].files,["packages/sql/src/Free.ts"])
    assert.deepEqual(plan.deferred.map(d=>d.file).sort(),corpus.retained)
  } finally {f.dispose()}
})

test("stale ordinary and one-pass plans are rejected before any source rename or compiler launch", async () => {
  const f=fixture()
  try {
    const run=join(f.base,"run"), p=paths(run)
    const json=(file,value)=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(value))}
    json(p.config,{target:f.root,packages:f.packages,toolchain:{dir:join(f.base,"missing-toolchain")}})
    for(const mode of [undefined,"one-pass"]){
      json(p.plan,{mode,batches:[{files:[corpus.retained[0]],reason:"old accepted plan"}]})
      await assert.rejects(()=>mode?onePassStep("rename",{run}):codemod({run,batch:"01"}),/unchanged test bundles/)
      assert.ok(existsSync(join(f.root,corpus.retained[0])))
      assert.equal(existsSync(join(f.root,corpus.retained[0].replace(/\.ts$/,".vibe"))),false)
    }
  } finally {f.dispose()}
})

test("type-only edges and emitted runtime exports are not source bundle dependencies", () => {
  const f=fixture()
  try {
    f.put("packages/cloudflare/src/Workers/SqlMigrationsApply.ts",'import {Effect} from "effect";\nimport type {T} from "../../../sql/src/Registry.ts";\nexport const apply=Effect.succeed(1);\n')
    let retained=testBundleDeferrals(f.root,Object.keys(corpus.files))
    assert.deepEqual(retained.map(d=>d.file),["packages/cloudflare/src/Workers/SqlMigrationsApply.ts"])
    f.put("packages/cloudflare/src/Workers/SqlMigrationsApply.ts",'import {Effect} from "effect";\nimport {registry} from "@alchemy.run/sql";\nexport const apply=Effect.succeed(registry);\n')
    f.put("packages/sql/package.json",JSON.stringify({name:"@alchemy.run/sql",exports:{".":{types:"./src/Registry.ts",default:"./lib/index.js"}}}))
    f.put("packages/sql/lib/index.js","export const registry=1;\n")
    retained=testBundleDeferrals(f.root,Object.keys(corpus.files))
    assert.deepEqual(retained.map(d=>d.file),["packages/cloudflare/src/Workers/SqlMigrationsApply.ts"])
  } finally {f.dispose()}
})

test("comments, string snippets, lexical shadows and foreign tests are not bundler calls", () => {
  const f=fixture()
  try {
    for(const source of [
      'const example = \'import("rolldown"); rolldown({input:"../../cloudflare/src/Providers.ts"})\';',
      '// import {rolldown} from "rolldown"; rolldown({input:"../../cloudflare/src/Providers.ts"})',
      'import {rolldown} from "rolldown"; function run(rolldown) {rolldown({input:"../../cloudflare/src/Providers.ts"})}'
    ]){
      f.put(corpus.test,source)
      assert.deepEqual(testBundleDeferrals(f.root,Object.keys(corpus.files)),[])
    }
    f.put(corpus.test,"export {}")
    f.put("vendor/package.json",'{"type":"module"}')
    f.put("vendor/test/foreign.test.ts",corpus.source)
    assert.deepEqual(testBundleDeferrals(f.root,Object.keys(corpus.files)),[])
  } finally {f.dispose()}
})

test("property: runtime import closures across aliases, cycles, extensions and nested test paths stay TypeScript", () => {
  fc.assert(fc.property(
    fc.array(fc.array(fc.nat(20),{maxLength:5}),{minLength:1,maxLength:10}),
    fc.boolean(),fc.constantFrom("ts","mts","tsx"),fc.integer({min:0,max:3}),
    (raw,bare,ext,depth)=>{
      const f=fixture()
      try{
        f.put(corpus.test,"export {}")
        const graph=raw.map(edges=>[...new Set(edges.map(n=>n%raw.length))])
        const files=graph.map((_,i)=>"packages/sql/src/Node"+i+"."+ext)
        f.put("packages/sql/package.json",JSON.stringify({name:"@alchemy.run/sql",exports:{"./*":"./src/*."+ext}}))
        graph.forEach((deps,i)=>f.put(files[i],'import {Effect} from "effect";\n'+deps.map(n=>'import "'+(bare?'@alchemy.run/sql/Node'+n:'./Node'+n+'.'+ext)+'";').join("\n")+'\nexport const value=Effect.succeed(1);\n'))
        const entry=files[0],testFile="packages/integration-tests/test/"+("nested/".repeat(depth))+"bundle.test.ts"
        const relative=posix.relative(posix.dirname(testFile),entry)
        f.put(testFile,'import {rolldown as build} from "rolldown"; const input=new URL('+JSON.stringify(relative)+',import.meta.url).pathname; build({input,plugins:[]});')
        const expected=new Set(),todo=[0]
        while(todo.length){const n=todo.pop();if(expected.has(n))continue;expected.add(n);todo.push(...graph[n])}
        const actual=testBundleDeferrals(f.root,files).map(d=>d.file)
        assert.deepEqual(actual,[...expected].map(n=>files[n]).sort())
      }finally{f.dispose()}
    }),{seed:520052,numRuns:300})
})

test("an unconditional native adapter supplied by a workspace plugin factory is already wired", () => {
  const f=fixture()
  try{
    f.put("packages/plugins/package.json",JSON.stringify({name:"@alchemy.run/plugins",exports:{".":"./src/index.ts"}}))
    f.put("packages/plugins/src/index.ts",'export {default} from "./factory.ts";\n')
    const native='import native from "vibelang-unplugin/rolldown"; const cloudflare = () => [native(),{name:"own"}]; export default cloudflare;\n'
    f.put("packages/plugins/src/factory.ts",native)
    f.put(corpus.test,'import cloudflare from "@alchemy.run/plugins";\n'+corpus.source.replace('plugins:[{name:"test-oracle"}]','plugins:[...cloudflare()]'))
    assert.deepEqual(testBundleDeferrals(f.root,Object.keys(corpus.files)),[])
    f.put("packages/plugins/src/factory.ts",'import native from "vibelang-unplugin/rolldown"; const cloudflare = (enabled=false) => [enabled ? native() : null]; export default cloudflare;\n')
    assert.deepEqual(testBundleDeferrals(f.root,Object.keys(corpus.files)).map(d=>d.file),corpus.retained)
    f.put("packages/plugins/src/factory.ts",'const native=()=>({name:"vibelang"}); const cloudflare=()=>[native()]; export default cloudflare;\n')
    assert.deepEqual(testBundleDeferrals(f.root,Object.keys(corpus.files)).map(d=>d.file),corpus.retained)
    f.put("packages/plugins/src/factory.ts",native.replace("vibelang-unplugin/rolldown","vibelang-unplugin/esbuild"))
    assert.deepEqual(testBundleDeferrals(f.root,Object.keys(corpus.files)).map(d=>d.file),corpus.retained)
  }finally{f.dispose()}
})

test("direct native adapters bypass retention; original esbuild, Bun.build and bun build CLI calls retain graphs", () => {
  const f=fixture()
  try{
    for(const source of [
      'import {build} from "esbuild"; build({entryPoints:["packages/cloudflare/src/Workers/SqlMigrationsApply.ts"]});',
      'Bun.build({entrypoints:["packages/cloudflare/src/Workers/SqlMigrationsApply.ts"]});',
      'import {spawnSync} from "node:child_process"; spawnSync("bun",["build","packages/cloudflare/src/Workers/SqlMigrationsApply.ts"]);'
    ]){
      f.put(corpus.test,source)
      assert.deepEqual(testBundleDeferrals(f.root,Object.keys(corpus.files)).map(d=>d.file),corpus.retained)
    }
    f.put(corpus.test,'import {build} from "esbuild"; import native from "vibelang-unplugin/esbuild"; build({entryPoints:["packages/cloudflare/src/Workers/SqlMigrationsApply.ts"],plugins:[native()]});')
    assert.deepEqual(testBundleDeferrals(f.root,Object.keys(corpus.files)),[])
  }finally{f.dispose()}
})

test("a test-only helper's bundler owns the reached graph without editing the helper", () => {
  const f=fixture()
  try{
    const helper="packages/integration-tests/helpers/bundle.ts"
    f.put(helper,corpus.source)
    f.put(corpus.test,'import "../helpers/bundle.ts";\n')
    const deferred=testBundleDeferrals(f.root,Object.keys(corpus.files))
    assert.deepEqual(deferred.map(d=>d.file),corpus.retained)
    assert.ok(deferred.every(d=>d.bundledBy[0].test===helper))
    assert.equal(readFileSync(join(f.root,helper),"utf8"),corpus.source)
  }finally{f.dispose()}
})

test("property: only unconditional native factories behind ESM export chains bypass retention", () => {
  assert.ok(readFileSync(new URL("../README.md",import.meta.url),"utf8").includes("Tests remain unchanged; their unconfigured source bundle graphs stay TypeScript."))
  fc.assert(fc.property(fc.integer({min:0,max:4}),fc.boolean(),fc.boolean(),(depth,native,conditional)=>{
    const f=fixture()
    try{
      f.put("packages/plugins/package.json",JSON.stringify({name:"@alchemy.run/plugins",exports:{".":"./src/index.ts"}}))
      const names=["index",...Array.from({length:depth},(_,i)=>"hop"+i),"factory"]
      for(let i=0;i+1<names.length;i++)f.put("packages/plugins/src/"+names[i]+".ts",'export {default} from "./'+names[i+1]+'.ts";')
      const imported=native?'import adapter from "vibelang-unplugin/rolldown";':'const adapter=()=>({name:"fake"});'
      f.put("packages/plugins/src/factory.ts",imported+' const cloudflare=(enabled=false)=>['+(conditional?'enabled ? adapter() : null':'adapter()')+'];export default cloudflare;')
      f.put(corpus.test,'import plugins from "@alchemy.run/plugins";\n'+corpus.source.replace('plugins:[{name:"test-oracle"}]','plugins:[...plugins()]'))
      assert.deepEqual(testBundleDeferrals(f.root,Object.keys(corpus.files)).map(d=>d.file),native&&!conditional?[]:corpus.retained)
    }finally{f.dispose()}
  }),{seed:520053,numRuns:100})
})

test("unresolved dynamic bundle inputs expose a located warning instead of a source-free certification", () => {
  const f=fixture()
  try{
    f.put(corpus.test,'import {rolldown} from "rolldown"; export function check(input) {return rolldown({input,plugins:[]})}')
    const inventory=f.inventory()
    assert.ok(inventory.bundleWarnings.some(w=>w.includes(corpus.test+":1:")&&w.includes("cannot resolve")))
    const proposed={batches:[{files:["packages/sql/src/Free.ts"],reason:"independent source"}]}
    assert.ok(validatePlan(proposed,inventory).warnings.some(w=>w.includes("cannot resolve")))
  }finally{f.dispose()}
})

test("scope checks read inherited tsconfig aliases before inventory exists", () => {
  const f=fixture()
  try{
    f.put("packages/cloudflare/base.json",JSON.stringify({compilerOptions:{baseUrl:".",paths:{"#registry":["../sql/src/Registry.ts"]}}}))
    f.put("packages/cloudflare/tsconfig.json",'{"extends":"./base.json","include":["src"]}')
    f.put("packages/cloudflare/src/Providers.ts",'import {Effect} from "effect";\nimport {registry} from "#registry";\nexport const provider=Effect.succeed(registry);\n')
    assert.deepEqual(testBundleDeferrals(f.root,Object.keys(corpus.files)).map(d=>d.file),corpus.retained)
    const scoped=planScope(f.root,Object.keys(corpus.files))
    assert.deepEqual(scoped.batches[0].files,["packages/sql/src/Free.ts"])
  }finally{f.dispose()}
})

test("file-URL inputs decode escaped source filenames and ignore URL queries", () => {
  const f=fixture()
  try{
    const file="packages/cloudflare/src/Workers/With space.ts"
    f.put(file,'import {Effect} from "effect"; export const value=Effect.succeed(1);')
    f.put(corpus.test,corpus.source.replace("SqlMigrationsApply.ts","With%20space.ts?cache=1"))
    assert.deepEqual(testBundleDeferrals(f.root,[file]).map(d=>d.file),[file])
  }finally{f.dispose()}
})

test("the standard vibelang-vite adapter also certifies an already wired Vite bundle", () => {
  const f=fixture()
  try{
    f.put(corpus.test,'import {build} from "vite"; import native from "vibelang-vite"; build({build:{rollupOptions:{input:"packages/cloudflare/src/Workers/SqlMigrationsApply.ts"}},plugins:[native()]});')
    assert.deepEqual(testBundleDeferrals(f.root,Object.keys(corpus.files)),[])
  }finally{f.dispose()}
})
