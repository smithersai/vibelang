import assert from "node:assert/strict"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { runInNewContext } from "node:vm"
import { test } from "node:test"
import { wireViteApps } from "../../../.smithers/flows/migrate/lib/wire.mjs"
import { fixture, remove, repo } from "../../../.smithers/flows/migrate/test/worker-workspaces-fixture.mjs"

const require=createRequire(join(repo,"packages/runtime/package.json"))
const ts=require("typescript")
const write=(root,file,text)=>writeFileSync(join(root,file),text)
test("opencode: actual Vite worker build compiles a dependency's typed .vibe import",async()=>{
 const {build}=await import(pathToFileURL(createRequire(join(repo,"packages/vite/package.json")).resolve("vite")).href)
 const {root,dir}=fixture({depth:1})
 try {
  const app=join(root,"packages/app")
  const config={root:app,configFile:join(app,"vite.config.ts"),logLevel:"silent",build:{write:false,minify:false}}
  const workerFile=join(root,dir,"src/presentation.worker.ts")
  const workerSource=readFileSync(workerFile,"utf8")
  write(root,dir+"/src/slide-text.ts",readFileSync(join(root,dir,"src/slide-text.vibe"),"utf8"))
  writeFileSync(workerFile,workerSource.replace("slide-text.vibe","slide-text.ts"))
  // Unmodified TypeScript control builds with the exact same Vite config.
  await build(config)
  rmSync(join(root,dir,"src/slide-text.ts"))
  writeFileSync(workerFile,workerSource)
  await assert.rejects(build(config),/slide-text|PARSE_ERROR|Expected|Unexpected|Parse/)
  wireViteApps({root,packages:[{dir}],ts,specsFor:()=>({vibelang:"0.0.11","vibelang-vite":"0.0.11"})})
  const text=readFileSync(join(app,"vite.config.ts"),"utf8")
  assert.match(text,/plugins: \(\) => \[vibelang\(\)\]/)
  // Vite loads the actual setup-edited config, including its worker factory.
  const output=await build(config)
  const chunks=(Array.isArray(output)?output:[output]).flatMap(o=>o.output)
  const worker=chunks.find(o=>o.fileName.endsWith(".js")&&String(o.source??o.code).includes("PowerPoint preview")&&String(o.source??o.code).includes("postMessage"))
  assert.ok(worker,chunks.map(o=>o.fileName).join("\n"))
  const messages=[]
  runInNewContext(String(worker.source??worker.code),{self:{postMessage:value=>messages.push(value)}})
  assert.deepEqual(messages,["PowerPoint preview"])
 } finally {remove(root)}
})
