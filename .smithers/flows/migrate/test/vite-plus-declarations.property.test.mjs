import assert from "node:assert/strict"
import { mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync } from "node:fs"
import { dirname,join,matchesGlob } from "node:path"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { runInNewContext } from "node:vm"
import { test } from "node:test"
import { addVitePlusIgnores } from "../lib/wire.mjs"
import { wireDeveloperTools } from "../lib/tooling.mjs"
const require=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url)),ts=require("typescript"),fc=require("fast-check")
const corpus=JSON.parse(readFileSync(new URL("./corpus/t3code-vite-plus-declarations.json",import.meta.url)))
const spec=readFileSync(new URL("../../../../docs/design/src/007-tooling.md",import.meta.url),"utf8")
const put=(root,file,text)=>{mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),text)}
const selected=(path,patterns)=>!patterns.some(p=>matchesGlob(path,p))
function config(text){
 const js=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ESNext}}).outputText
 return runInNewContext(js.replace(/^import .*$/gm,"").replace("export default","result ="),{defineConfig:value=>typeof value==="function"?value({mode:"production"}):value})
}
test("setup wires embedded Vite+ formatter and linter declaration ignores",async t=>{
 assert.ok(spec.includes(corpus.quote))
 const root=mkdtempSync(join(tmpdir(),"vite-plus-declaration-ignore-"));t.after(()=>rmSync(root,{recursive:true,force:true}))
 put(root,"package.json",'{"name":"fixture","private":true,"devDependencies":{"vite-plus":"0.1.0"}}')
 put(root,"vite.config.ts",corpus.config)
 wireDeveloperTools({root,ts,specsFor:()=>({vibelang:"0.0.11"})})
 const output=readFileSync(join(root,"vite.config.ts"),"utf8"),value=config(output)
 for(const section of ["fmt","lint"]){
  assert.equal(selected(corpus.generated,value[section].ignorePatterns),false)
  assert.equal(selected(corpus.authored,value[section].ignorePatterns),true)
  assert.ok(value[section].ignorePatterns.includes("owned/**"))
 }
 assert.equal(JSON.stringify(value.test),JSON.stringify(config(corpus.config).test))
 assert.equal(addVitePlusIgnores(output,ts),output)
 const bin=process.env.VIBELANG_OXLINT_BINARY
 await t.test("real embedded Oxlint options retain authored diagnostics",{skip:!bin},()=>{
  put(root,corpus.generated,corpus.declaration);put(root,corpus.authored,"export const value = 1;\n")
  put(root,".oxlintrc.json",JSON.stringify(value.lint))
  const lint=()=>spawnSync(bin,["--config",".oxlintrc.json","--disable-nested-config","src"],{cwd:root,encoding:"utf8"})
  const clean=lint();assert.equal(clean.status,0,clean.stdout+clean.stderr)
  put(root,corpus.authored,corpus.declaration)
  const bad=lint();assert.equal(bad.status,1,bad.stdout+bad.stderr)
  assert.match(bad.stdout+bad.stderr,/require-module-specifiers/)
 })
})
test("Vite+ ignore neighbourhood preserves nested settings and authored code",()=>{
 fc.assert(fc.property(fc.record({quote:fc.constantFrom('"',"'"),factory:fc.boolean(),empty:fc.boolean(),multiline:fc.boolean(),jsx:fc.boolean(),depth:fc.integer({min:0,max:3})}),({quote,factory,empty,multiline,jsx,depth})=>{
  const values=empty?"":quote+"owned/**"+quote
  const list=multiline?"[\n    "+values+"\n  ]":"["+values+"]"
  const object="{ fmt: { ignorePatterns: "+list+" }, lint: { ignorePatterns: "+list+" }, test: { exclude: ['keep/**'] }, other: { lint: { ignorePatterns: ['nested/**'] } } }"
  const input="import { defineConfig } from "+quote+"vite-plus"+quote+";\nexport default defineConfig("+(factory?"() => (":"")+object+(factory?")":"")+");\n"
  const output=addVitePlusIgnores(input,ts);assert.ok(output)
  const a=config(input),b=config(output),base="src/"+"nested/".repeat(depth)+"entry",ext=jsx?"vibex":"vibe"
  for(const section of ["fmt","lint"]){
   assert.equal(selected(base+"."+ext+".platform.d.ts",b[section].ignorePatterns),false)
   assert.equal(selected(base+".d."+ext+".ts",b[section].ignorePatterns),false)
   for(const suffix of [".ts",".tsx",".vibe",".vibex",".platform.ts","."+ext+".platform.ts"])assert.equal(selected(base+suffix,b[section].ignorePatterns),true)
  }
  assert.equal(JSON.stringify(a.test),JSON.stringify(b.test));assert.equal(JSON.stringify(a.other),JSON.stringify(b.other))
  assert.equal(addVitePlusIgnores(output,ts),output)
 }),{seed:440213,numRuns:100,endOnFailure:true})
})
test("ordinary Vite and computed Vite+ configurations retain their ownership",()=>{
 assert.equal(addVitePlusIgnores(corpus.config.replace('"vite-plus"','"vite"'),ts),corpus.config.replace('"vite-plus"','"vite"'))
 for(const expression of ["options","{ lint: options }","{ lint: { ignorePatterns: ignores } }","{ ...options }","{ fmt: {}, ...options }"]){
  assert.equal(addVitePlusIgnores('import { defineConfig } from "vite-plus"; export default defineConfig('+expression+');',ts),null)
 }
 const text='import { defineConfig } from "vite-plus"; export default defineConfig({});'
 const value=config(addVitePlusIgnores(text,ts));assert.ok(value.fmt.ignorePatterns.length);assert.ok(value.lint.ignorePatterns.length)
})


test("only the exported Vite+ configuration receives ignores",()=>{
 const prefix='import { defineConfig } from "vite-plus";\nconst unrelated = defineConfig({ lint: { ignorePatterns: ["keep/**"] } });\n'
 const source=prefix+'export default defineConfig({ fmt: {}, lint: {} });\n'
 const output=addVitePlusIgnores(source,ts)
 assert.ok(output.startsWith(prefix))
 assert.ok(config(output).lint.ignorePatterns.includes("**/*.vibe.*.d.ts"))
})
