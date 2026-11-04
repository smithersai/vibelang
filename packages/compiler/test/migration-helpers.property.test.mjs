import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { rewriteImports } from "../../../.smithers/flows/migrate/lib/codemod.mjs"
import { wireViteApps } from "../../../.smithers/flows/migrate/lib/wire.mjs"
import { loadTypeScript } from "../../../.smithers/flows/migrate/lib/declarations.mjs"
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const regressions = new URL("./property-regressions/", import.meta.url)
const ts = loadTypeScript([join(repo,"packages/runtime")])
const tooling=readFileSync(join(repo,"docs/design/src/007-tooling.md"),"utf8")
let diagnostics=""
const write=(root,file,text)=>{const p=join(root,file);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,text)}
test("migration helper oracles quote the current specification",()=>{ assert.ok(tooling.includes("Type checkers use `.d.vibe.ts`; linters, Knip, bundlers and test runners read `.vibe`.")) })
test("mock.module reaches the generated source while unmigrated mocks keep their spelling",async()=>{
 await checkProperty(fc,{
  name:"opencode-mock-source-paths",rule:'docs/design/src/007-tooling.md: "Type checkers use `.d.vibe.ts`; linters, Knip, bundlers and test runners read `.vibe`."; Bun mocks keep matching the renamed module',
  command:"node --test test/migration-helpers.property.test.mjs",regressions,numRuns:50,
  arbitrary:fc.record({name:fc.constantFrom("mini","runtime","stats.core"),directory:fc.boolean(),extension:fc.constantFrom("none","js","ts"),mocked:fc.integer({min:2,max:999})}),
  diagnostics:()=>diagnostics,
  artifacts:input=>({"test/mock.test.ts":'mock.module("../src/'+input.name+'", () => ({ value: '+input.mocked+' }))\n'}),
  check:input=>{
   const root=mkdtempSync(join(tmpdir(),"opencode-mock-property-"))
   try{
    const module="src/"+input.name+(input.directory?"/index":"")+".vibe"
    const from="../src/"+input.name+(input.extension==="none"?"":(input.directory?"/index":"")+"."+input.extension)
    const target="../"+module
    const code='import { mock } from "bun:test"\nmock.module('+JSON.stringify(from)+', () => ({ value: '+input.mocked+' }))\nmock.module("../src/other", () => ({ other: 7 }))\nconst { value } = await import('+JSON.stringify(target)+')\nconst { other } = await import("../src/other.ts")\nconsole.log(JSON.stringify({value, other}))\n'
    write(root,module,"export const value = 1\n");write(root,"src/other.ts","export const other = 0\n");write(root,"test/mock.test.ts",code)
    write(root,"package.json",'{"type":"module"}\n')
    write(root,"tsconfig.json",'{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","types":[]}}\n')
    mkdirSync(join(root,"node_modules"),{recursive:true})
    for(const [name,path]of [["vibelang","packages/compiler"],["vibelang-runtime","packages/runtime"]])symlinkSync(join(repo,path),join(root,"node_modules",name))
    const scope=[module,"src/other.ts","test/mock.test.ts"]
    const edits=rewriteImports(root,scope)
    assert.deepEqual(edits,[{file:"test/mock.test.ts",from,to:target}])
    assert.ok(readFileSync(join(root,"test/mock.test.ts"),"utf8").includes('mock.module("../src/other"'))
    assert.deepEqual(rewriteImports(root,scope),[])
    const result=spawnSync("bun",["--preload","vibelang/bun","test/mock.test.ts"],{cwd:root,encoding:"utf8",timeout:30000})
    diagnostics=JSON.stringify({input,edits,status:result.status,stdout:result.stdout,stderr:result.stderr}).replaceAll(root,"<project>")
    assert.ifError(result.error);assert.equal(result.status,0,diagnostics)
    assert.deepEqual(JSON.parse(result.stdout),{value:input.mocked,other:7},diagnostics)
   }finally{rmSync(root,{recursive:true,force:true})}
  }
 })
})
test("setup wires named Vite configs in reaching packages and preserves excluded configs",async()=>{
 await checkProperty(fc,{
  name:"opencode-named-vite-configs",rule:'docs/design/src/007-tooling.md: "Type checkers use `.d.vibe.ts`; linters, Knip, bundlers and test runners read `.vibe`."; migration setup wires configs that bundle migrated sources',
  command:"node --test test/migration-helpers.property.test.mjs",regressions,numRuns:60,
  arbitrary:fc.record({name:fc.constantFrom("node","cli-node","browser","prod_1"),extension:fc.constantFrom("ts","mts","js","mjs"),prefix:fc.constantFrom("vite","vitest"),factory:fc.boolean(),supported:fc.boolean()}),
  diagnostics:()=>diagnostics,
  artifacts:input=>({["packages/cli/"+input.prefix+"."+input.name+".config."+input.extension]:'export const mainConfig = () => defineConfig({ plugins: [solid()] })\n'}),
  check:input=>{
   const root=mkdtempSync(join(tmpdir(),"opencode-config-property-"))
   try{
    write(root,"packages/theme/package.json",JSON.stringify({name:"theme"}))
    write(root,"packages/cli/package.json",JSON.stringify({name:"cli",dependencies:{theme:"workspace:*"}}))
    write(root,"packages/other/package.json",JSON.stringify({name:"other"}))
    const file="packages/cli/"+input.prefix+"."+input.name+".config."+input.extension
    const config=input.supported?'import { defineConfig } from "vite"\n'+(input.factory?'export const mainConfig = () => ':'export default ')+'defineConfig({ plugins: [solid()] })\n':'export default {}\n'
    write(root,file,config)
    for(const excluded of ["packages/cli/test/vite.node.config.ts","packages/cli/fixture/vite.node.config.ts","packages/other/vite.node.config.ts","packages/cli/vite.config.backup.ts.txt"])write(root,excluded,config)
    const options={root,packages:[{dir:"packages/theme"}],ts,specsFor:()=>({vibelang:"0.0.11","vibelang-vite":"0.0.11"})}
    const result=wireViteApps(options)
    diagnostics=JSON.stringify({input,result,text:readFileSync(join(root,file),"utf8")})
    assert.deepEqual(result.configs,input.supported?[file]:[],diagnostics)
    assert.equal(result.warnings.length,input.supported?0:1,diagnostics)
    if(input.supported)assert.match(readFileSync(join(root,file),"utf8"),/plugins: \[vibelang\(\), solid\(\)\]/)
    else assert.ok(result.warnings[0].startsWith(file+": "))
    for(const excluded of ["packages/cli/test/vite.node.config.ts","packages/cli/fixture/vite.node.config.ts","packages/other/vite.node.config.ts","packages/cli/vite.config.backup.ts.txt"])assert.equal(readFileSync(join(root,excluded),"utf8"),config)
    assert.deepEqual(wireViteApps(options).changed,[],"rerun is idempotent")
   }finally{rmSync(root,{recursive:true,force:true})}
  }
 })
})
