import assert from "node:assert/strict"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { startsWorkers, wireViteApps } from "../lib/wire.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
import { fixture, remove } from "./worker-workspaces-fixture.mjs"

const repo=fileURLToPath(new URL("../../../../",import.meta.url))
const require=createRequire(join(repo,"packages/runtime/package.json"))
const ts=require("typescript"), fc=require("fast-check")
const rule="Type checkers work through `.d.vibe.ts`, and linters, Knip, bundlers and test runners each read `.vibe`."
const write=(root,file,text)=>{mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),text)}
test("opencode: a Vite app wires workers started by a workspace dependency",()=>{
 const {root,dir}=fixture({depth:2,cycle:true})
 try {
  assert.equal(startsWorkers(root,"packages/app"),true)
  const result=wireViteApps({root,packages:[{dir}],ts,specsFor:()=>({vibelang:"0.0.11","vibelang-vite":"0.0.11"})})
  assert.deepEqual(result.warnings,[])
  const config=readFileSync(join(root,"packages/app/vite.config.ts"),"utf8")
  assert.match(config,/plugins: \(\) => \[vibelang\(\)\]/)
  assert.equal(wireViteApps({root,packages:[{dir}],ts,specsFor:()=>({vibelang:"0.0.11","vibelang-vite":"0.0.11"})}).changed.length,0)
 } finally {remove(root)}
})
test("property: worker discovery follows local dependency cycles and excludes unrelated/protected trees",async()=>{
 await checkProperty(fc,{name:"opencode-worker-workspaces",rule,command:"node --test test/worker-workspaces.property.test.mjs",arbitrary:fc.record({depth:fc.integer({min:1,max:5}),cycle:fc.boolean(),field:fc.constantFrom("dependencies","devDependencies","peerDependencies","optionalDependencies"),kind:fc.constantFrom("worker","shared","query"),spec:fc.constantFrom("workspace:*","file:../local","link:../local","*"),protected:fc.constantFrom("test","tests","__tests__","fixtures","templates")}),numRuns:80,generatorVersion:1,regressions:new URL("./corpus/",import.meta.url),check:input=>{
  const {root,dir}=fixture(input)
  try {
   assert.equal(startsWorkers(root,"packages/app"),true)
   const wired=wireViteApps({root,packages:[{dir}],ts,specsFor:()=>({vibelang:"0.0.11","vibelang-vite":"0.0.11"})})
   assert.deepEqual(wired.warnings,[])
   assert.match(readFileSync(join(root,"packages/app/vite.config.ts"),"utf8"),/plugins: \(\) => \[vibelang\(\)\]/)
   rmSync(join(root,dir,"src"),{recursive:true})
   write(root,dir+"/"+input.protected+"/a.ts",'new Worker(new URL("./x.ts", import.meta.url))')
   assert.equal(startsWorkers(root,"packages/app"),false)
  } finally {remove(root)}
 }})
})

test("worker discovery does not cross registry or nested-package boundaries",()=>{
 const {root}=fixture({depth:1})
 try {
  const app=JSON.parse(readFileSync(join(root,"packages/app/package.json"),"utf8"))
  app.dependencies.dep1="^1.0.0"
  write(root,"packages/app/package.json",JSON.stringify(app))
  assert.equal(startsWorkers(root,"packages/app"),false)
  assert.equal(startsWorkers(root,"packages/dep1"),true)
  assert.equal(startsWorkers(root,"."),false)
  app.dependencies.dep1="workspace:*"
  write(root,"packages/app/package.json",JSON.stringify(app))
  const manifest=JSON.parse(readFileSync(join(root,"package.json"),"utf8"))
  manifest.dependencies={app:"workspace:*"}
  write(root,"package.json",JSON.stringify(manifest))
  assert.equal(startsWorkers(root,"."),true)
 } finally {remove(root)}
})
