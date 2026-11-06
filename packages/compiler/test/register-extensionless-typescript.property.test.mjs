import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { test } from "node:test"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
const repo=process.env.VIBELANG_EXTENSIONLESS_TEST_ROOT || fileURLToPath(new URL("../../../",import.meta.url))
const require=createRequire(join(repo,"packages/runtime/package.json"))
const fc=require("fast-check"),ts=require("typescript")
const register=process.env.VIBELANG_EXTENSIONLESS_REGISTER || join(repo,"packages/compiler/register.mjs")
const compiler=process.env.VIBELANG_BINARY || join(repo,"typescript/built/local/tsc")
const corpus=JSON.parse(readFileSync(process.env.VIBELANG_EXTENSIONLESS_CORPUS || new URL("./corpus/smithers-vite-extensionless-typescript.json",import.meta.url),"utf8"))
function witness(input) {
 const root=realpathSync(mkdtempSync(join(tmpdir(),"native-extensionless-ts-")))
 const write=(f,text)=>{mkdirSync(dirname(join(root,f)),{recursive:true});writeFileSync(join(root,f),text)}
 try {
  mkdirSync(join(root,"node_modules"))
  symlinkSync(join(repo,"packages/runtime/node_modules/effect"),join(root,"node_modules/effect"))
  symlinkSync(join(repo,"packages/runtime"),join(root,"node_modules/vibelang-runtime"))
  write("package.json",'{"type":"module"}')
  const target="src/"+input.name+(input.layout==="index"?"/index":"")+"."+input.kind
  const specifier="./"+input.name
  write(target,'export const marker = {}; export const limit = 42\n')
  if(input.priority)write("src/"+input.name+".js",'export const marker = {}; export const limit = -1\n')
  const options={target:"ES2022",module:"ESNext",moduleResolution:"Bundler",strict:true,skipLibCheck:true,types:[],allowJs:true,noEmit:true,allowImportingTsExtensions:true}
  write("tsconfig.json",JSON.stringify({compilerOptions:options,include:["src/**/*"]}))
  const written=ts.resolveModuleName(specifier,join(root,"src/twin.ts"),{moduleResolution:ts.ModuleResolutionKind.Bundler,allowJs:true},ts.sys).resolvedModule
  assert.equal(written?.resolvedFileName,join(root,target),"TypeScript Bundler resolution oracle")
  const implementation='import {marker,limit} from '+JSON.stringify(specifier)+'; export const settings = {marker,limit}\n'
  write("src/config.vibe",input.body?"module options {\n"+implementation+"}\nexport {settings} from options\n":implementation)
  const load=input.consumer==="import"?"await import":input.consumer==="require"?"require":'require("node:module").createRequire(__filename)'
  const ext=input.consumer==="import"?"mjs":"cjs"
  write("src/main."+ext,'const left='+load+'("./config.vibe");const right='+load+'('+JSON.stringify("./"+target.slice(4))+');console.log(JSON.stringify({limit:left.settings.limit,same:left.settings.marker===right.marker}))\n')
  const result=spawnSync(process.execPath,["--import",register,"src/main."+ext],{cwd:root,encoding:"utf8",timeout:20000,env:{...process.env,VIBELANG_BINARY:compiler,VIBELANG_PROJECT:"",VIBELANG_CACHE_DIR:join(root,".cache")}})
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr)
  assert.deepEqual(JSON.parse(result.stdout),{limit:42,same:true})
 } finally {rmSync(root,{recursive:true,force:true})}
}
test("a migrated config helper loads its unchanged TypeScript sibling",()=>{witness(corpus.case);witness({...corpus.case,layout:"index"})})
test("compiled source follows TypeScript file/index priority and preserves identity",()=>{
 fc.assert(fc.property(fc.record({
  name:fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/),layout:fc.constantFrom("file","index"),
  kind:fc.constantFrom("ts","js"),body:fc.boolean(),consumer:fc.constantFrom("import","require","createRequire")
 }),witness),{seed:110606,numRuns:36})
 for(const consumer of ["import","require","createRequire"])witness({name:"contract",layout:"file",kind:"ts",consumer,priority:true})
})
test("ordinary JavaScript retains native extensionless TypeScript resolution",()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),"native-extensionless-control-")))
 try {
  writeFileSync(join(root,"package.json"),'{"type":"module"}')
  writeFileSync(join(root,"contract.ts"),"export const value = 1\n")
  writeFileSync(join(root,"main.mjs"),'import {value} from "./contract";console.log(value)\n')
  const r=spawnSync(process.execPath,["--import",register,"main.mjs"],{cwd:root,encoding:"utf8",timeout:10000})
  assert.equal(r.status,1);assert.match(r.stderr,/ERR_MODULE_NOT_FOUND/)
 } finally {rmSync(root,{recursive:true,force:true})}
})
test("declarations alone do not become runtime imports",()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),"native-extensionless-declaration-")))
 const write=(f,text)=>{mkdirSync(dirname(join(root,f)),{recursive:true});writeFileSync(join(root,f),text)}
 try {
  mkdirSync(join(root,"node_modules"))
  symlinkSync(join(repo,"packages/runtime/node_modules/effect"),join(root,"node_modules/effect"))
  symlinkSync(join(repo,"packages/runtime"),join(root,"node_modules/vibelang-runtime"))
  write("package.json",'{"type":"module"}')
  write("tsconfig.json",JSON.stringify({compilerOptions:{target:"ES2022",module:"ESNext",moduleResolution:"Bundler",strict:true,skipLibCheck:true,types:[],noEmit:true},include:["src/**/*"]}))
  write("src/contract.d.ts","export declare const limit: number\n")
  write("src/config.vibe",'import {limit} from "./contract"; export const settings = limit\n')
  write("src/main.mjs",'import {settings} from "./config.vibe";console.log(settings)\n')
  const r=spawnSync(process.execPath,["--import",register,"src/main.mjs"],{cwd:root,encoding:"utf8",timeout:20000,env:{...process.env,VIBELANG_BINARY:compiler,VIBELANG_PROJECT:"",VIBELANG_CACHE_DIR:join(root,".cache")}})
  assert.ifError(r.error);assert.equal(r.status,1);assert.match(r.stderr,/ERR_MODULE_NOT_FOUND/)
 } finally {rmSync(root,{recursive:true,force:true})}
})
