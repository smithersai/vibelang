import assert from "node:assert/strict"
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from "node:fs"
import {createRequire} from "node:module"
import {dirname,join} from "node:path"
import {tmpdir} from "node:os"
import {fileURLToPath} from "node:url"
import {spawnSync} from "node:child_process"
import {test} from "node:test"
import {wireEmittedProjects,emitMigratedJs} from "../lib/steps.mjs"
import {wirePublishingScripts} from "../lib/publishing.mjs"
import {compareDeclarations} from "../lib/declarations.mjs"
const repo=fileURLToPath(new URL("../../../../",import.meta.url))
const runtime=join(repo,"packages/runtime"),compiler=process.env.VIBELANG_BINARY??join(repo,"packages/compiler/native/vibelang")
const require=createRequire(join(runtime,"package.json")),ts=require("typescript")
const bunHelp=spawnSync("bun",["check","--help"],{encoding:"utf8"})
const nativeBun=bunHelp.status===0&&(bunHelp.stdout+bunHelp.stderr).includes("--threads")
const available=existsSync(compiler)&&nativeBun
test("source routes preserve Node/Bun module identity and normal packed declarations",{skip:!available&&!process.env.VIBELANG_SOURCE_ROUTE_RUNTIME_REQUIRE,timeout:240000},async()=>{
 assert.ok(available,"native compiler and Bun native checker are required")
 const root=mkdtempSync(join(tmpdir(),"opencode-source-route-runtime-")),commands=[]
 const proof=join(repo,".cache/bun101/runtime-proof")
 const put=(path,text)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text)}
 const json=(path,value)=>put(path,JSON.stringify(value,null,2)+"\n")
 const env={...process.env,VIBELANG_BINARY:compiler,VIBELANG_RUNTIME:runtime,VIBELANG_PROJECT:"",VIBELANG_CACHE_DIR:join(root,"cache")}
 const run=(stage,command,args,cwd=root,expected=0)=>{
  const result=spawnSync(command,args,{cwd,env,encoding:"utf8",timeout:120000,maxBuffer:16<<20})
  commands.push({stage,exit:result.status,stdout:result.stdout?.slice(-3000),stderr:result.stderr?.slice(-3000)})
  assert.equal(result.status,expected,stage+"\n"+result.stdout+"\n"+result.stderr)
  return result.stdout
 }
 const check=(dir,expected=0)=>run("installed native check","bun",["check","--no-script","--threads","4","-p","tsconfig.json"],dir,expected)
 const source='export interface CachePolicyObject { readonly tools?: boolean; readonly brand?: unique symbol }\nexport function CacheHint(policy: CachePolicyObject): boolean { return policy.tools ?? false }\n'
 const importer=extension=>'import { CacheHint, type CachePolicyObject } from "./schema/options.'+extension+'"\nexport {CacheHint}\nexport const select = (policy: CachePolicyObject): boolean => CacheHint(policy)\n'
 const manifest={name:"probe-ai",version:"1.0.0",type:"module",exports:{".":"./src/cache-policy.ts","./options":"./src/schema/options.ts"},files:["dist",".vibelang/js"],scripts:{build:'node "'+require.resolve("typescript/bin/tsc")+'" -p tsconfig.build.json',pack:"bun script/pack.ts"}}
 const options={target:"ES2022",module:"preserve",moduleResolution:"bundler",strict:true,noEmit:true,allowArbitraryExtensions:true,allowImportingTsExtensions:true,rewriteRelativeImportExtensions:true,skipLibCheck:false,types:[]}
 const nativeMapper=JSON.parse(readFileSync(new URL("./corpus/opencode-sdk-conditional-imports.json",import.meta.url),"utf8")).source
 const packScript='import {cpSync,existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs"\nimport {resolve,join} from "node:path"\nimport {spawnSync} from "node:child_process"\n'+nativeMapper+`
const destination=resolve(process.argv[2])
const stage=join(destination,"package")
mkdirSync(stage,{recursive:true})
const pkg=packImports(JSON.parse(readFileSync("package.json","utf8")),"schema")
writeFileSync(join(stage,"package.json"),JSON.stringify(pkg,null,2))
for(const folder of ["dist",".vibelang/js"])if(existsSync(folder))cpSync(folder,join(stage,folder),{recursive:true})
const packed=spawnSync("npm",["pack","--ignore-scripts","--json","--pack-destination",destination],{cwd:stage,encoding:"utf8",timeout:60000})
if(packed.status!==0)throw new Error(packed.stdout+packed.stderr)
process.stdout.write(packed.stdout)
`
 const packages=[{dir:"ai",tsconfig:"tsconfig.json",sources:["src"]}],config={target:root,packages,toolchain:{kind:"installed"}}
 const packed=label=>{
  const destination=join(root,"pack-"+label)
  mkdirSync(destination,{recursive:true})
  const output=run(label+" normal pack","bun",["run","pack",destination],join(root,"ai"))
  const archive=JSON.parse(output.trim()).at(-1).filename
  const consumer=join(root,"consume-"+label)
  mkdirSync(consumer,{recursive:true})
  writeFileSync(join(consumer,"package.json"),'{"name":"consumer","private":true,"type":"module"}')
  run(label+" install actual tarball","npm",["install","--ignore-scripts","--no-audit","--no-fund",join(destination,archive)],consumer)
  writeFileSync(join(consumer,"tsconfig.json"),JSON.stringify({compilerOptions:options,include:["index.ts"]}))
  const program='import {CacheHint as via,select} from "probe-ai"; import {CacheHint as direct} from "probe-ai/options"; const value: boolean = select({tools:true}); console.log(via === direct,value)\n'
  writeFileSync(join(consumer,"index.ts"),program)
  check(consumer)
  assert.equal(run(label+" installed Node",process.execPath,["index.ts"],consumer).trim(),"true true")
  assert.equal(run(label+" installed Bun","bun",["index.ts"],consumer).trim(),"true true")
  writeFileSync(join(consumer,"index.ts"),program.replace("value: boolean","value: string"))
  const errors=check(consumer,1)
  assert.match(errors+(commands.at(-1).stderr??""),/TS2322/)
  writeFileSync(join(consumer,"index.ts"),program)
  cpSync(join(destination,archive),join(proof,label+".tgz"))
  return join(consumer,"node_modules/probe-ai")
 }
 try{
  mkdirSync(proof,{recursive:true})
  json("package.json",{type:"module",private:true})
  json("ai/package.json",manifest)
  json("ai/tsconfig.json",{compilerOptions:options,include:["src"],vibe:{sidecarDir:".vibe/declarations"}})
  json("ai/tsconfig.build.json",{extends:"./tsconfig.json",compilerOptions:{noEmit:false,declaration:true,emitDeclarationOnly:false,rootDir:"src",outDir:"dist"},include:["src"]})
  put("ai/src/schema/options.ts",source)
  put("ai/src/cache-policy.ts",importer("ts"))
  put("ai/script/pack.ts",packScript)
  mkdirSync(join(root,"node_modules"),{recursive:true})
  for(const name of ["effect","typescript","@types"])symlinkSync(join(runtime,"node_modules",name),join(root,"node_modules",name),"dir")
  symlinkSync(join(repo,"packages/compiler"),join(root,"node_modules/vibelang"),"dir")
  symlinkSync(runtime,join(root,"node_modules/vibelang-runtime"),"dir")
  symlinkSync(join(root,"ai"),join(root,"node_modules/probe-ai"),"dir")
  mkdirSync(join(root,"ai/node_modules/.bin"),{recursive:true})
  symlinkSync(compiler,join(root,"ai/node_modules/.bin/vibelang"),"file")
  run("native build","bun",["run","build"],join(root,"ai"))
  const nativePackage=packed("native")
  rmSync(join(root,"ai/src/schema/options.ts"))
  put("ai/src/schema/options.vibe",source)
  put("ai/src/cache-policy.ts",importer("vibe"))
  manifest.scripts.build="vibelang -p tsconfig.build.json"
  manifest.exports["./options"]={types:"./.vibe/declarations/src/schema/options.d.vibe.ts","vibelang-source":"./src/schema/options.vibe",default:"./.vibelang/js/src/schema/options.js"}
  json("ai/package.json",manifest)
  put("ai/.vibe/declarations/src/schema/options.d.vibe.ts",source.replace("export function CacheHint(policy: CachePolicyObject): boolean { return policy.tools ?? false }","export declare function CacheHint(policy: CachePolicyObject): boolean;"))
  put("source.mjs",'import {CacheHint as via,select} from "./ai/src/cache-policy.ts"; import {CacheHint as direct} from "./ai/src/schema/options.vibe"; console.log(via === direct,select({tools:true}))\n')
  const nodeArgs=["--import",join(repo,"packages/compiler/register.mjs"),"source.mjs"]
  const bunArgs=["--preload",join(repo,"packages/compiler/bun.mjs"),"source.mjs"]
  assert.equal(run("before Node source identity",process.execPath,nodeArgs).trim(),"true true")
  assert.equal(run("before Bun source identity","bun",bunArgs).trim(),"true true")
  const wired=await wireEmittedProjects(config,ts,join(root,"wire-logs"))
  assert.ok(wired.changed.includes("ai/src/cache-policy.ts"))
  assert.equal(run("routed Node source identity",process.execPath,nodeArgs).trim(),"true true")
  assert.equal(run("routed Bun source identity","bun",bunArgs).trim(),"true true")
  const emitted=await emitMigratedJs(config,root,join(root,"emit-logs"))
  for(const result of emitted)assert.equal(result.code,0,JSON.stringify(result))
  const route=JSON.parse(readFileSync(join(root,"ai/package.json"),"utf8")).imports["#vibelang/source/src/schema/options"]
  assert.ok(route.default.startsWith("./.vibelang/js/"))
  assert.ok(existsSync(join(root,"ai",route.default)))
  assert.equal(run("emitted Node source identity",process.execPath,nodeArgs).trim(),"true true")
  assert.equal(run("emitted Bun source identity","bun",bunArgs).trim(),"true true")
  put("workspace.mjs",'import {CacheHint as via,select} from "probe-ai"; import {CacheHint as direct} from "probe-ai/options"; console.log(via === direct,select({tools:true}))\n')
  assert.equal(run("plain Node emitted graph",process.execPath,["workspace.mjs"]).trim(),"true true")
  assert.equal(run("plain Bun emitted graph","bun",["workspace.mjs"]).trim(),"true true")
  const publishing=wirePublishingScripts({root,ts})
  assert.ok(publishing.files?.length??publishing.changed?.length??publishing.length,"normal publication mapper must be wired")
  run("migrated normal build","bun",["run","build"],join(root,"ai"))
  const migratedPackage=packed("migrated")
  const compared=compareDeclarations(ts,nativePackage,migratedPackage)
  assert.equal(compared.comparisonComplete,true,JSON.stringify(compared))
  assert.equal(compared.identical,true,JSON.stringify(compared))
  writeFileSync(join(proof,"receipt.json"),JSON.stringify({commands,sourceRoute:route,comparisonComplete:compared.comparisonComplete,identical:compared.identical},null,2)+"\n")
 }finally{
  writeFileSync(join(proof,"commands.json"),JSON.stringify(commands,null,2)+"\n")
  rmSync(root,{recursive:true,force:true})
 }
})
