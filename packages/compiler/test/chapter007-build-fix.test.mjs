import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync,symlinkSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
import {test} from "node:test"
const repo=fileURLToPath(new URL("../../../",import.meta.url))
const binary=process.env.VIBELANG_BINARY||join(repo,"packages/compiler/native/vibelang")
// Chapter 007 / build fixes owned sources in project dependency order: docs/design/src/007-tooling.md#a1beb9c6c673c47b
test("Chapter 007 / --fix -b handles each referenced project's owned sources in build order",t=>{
 const root=mkdtempSync(join(tmpdir(),"chapter007-build-fix-"));t.after(()=>rmSync(root,{recursive:true,force:true}))
 mkdirSync(join(root,"node_modules"));symlinkSync(join(process.env.EFFECT_NODE_MODULES||join(repo,"experiments/node_modules"),"effect"),join(root,"node_modules/effect"))
 writeFileSync(join(root,"package.json"),'{"type":"module"}')
 const source='import {Effect} from "effect";export type Run=Effect.Effect<number>;\n'
 for(const name of ["lib","app"]){
  mkdirSync(join(root,name))
  writeFileSync(join(root,name,"own.vibe"),source)
  writeFileSync(join(root,name,"foreign.ts"),source)
  writeFileSync(join(root,name,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",composite:true,rootDir:".",outDir:"dist",strict:true,types:[]},files:["own.vibe","foreign.ts"],...(name==="app"?{references:[{path:"../lib"}]}:{})}))
 }
 writeFileSync(join(root,"tsconfig.json"),JSON.stringify({files:[],references:[{path:"app"}]}))
 const result=spawnSync(binary,["--fix","-b","tsconfig.json","--pretty","false"],{cwd:root,encoding:"utf8",timeout:120000})
 assert.equal(result.status,0,result.stdout+result.stderr)
 for(const name of ["lib","app"]){
  assert.notEqual(readFileSync(join(root,name,"own.vibe"),"utf8"),source)
  assert.equal(readFileSync(join(root,name,"foreign.ts"),"utf8"),source)
 }
 const lib=result.stdout.indexOf("lib/own.vibe"),app=result.stdout.indexOf("app/own.vibe")
 assert.ok(lib>=0&&app>lib,result.stdout)
})

for (const code of ["EK4609", "EK0801"]) {
 test(`Chapter 007 / build config migration preserves ${code} policy`, t => {
  const root = mkdtempSync(join(tmpdir(), "chapter007-build-config-"))
  t.after(() => rmSync(root, {recursive:true, force:true}))
  mkdirSync(join(root, "leaf"))
  symlinkSync(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), join(root, "node_modules"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({files:[], references:[{path:"./leaf"}]}))
  const config = JSON.stringify({compilerOptions:{composite:true, skipLibCheck:true, types:[], target:"ES2022", module:"NodeNext"}, files:["main.vibe"], vibelang:{diagnostics:{[code]:"off"}}})
  writeFileSync(join(root, "leaf/tsconfig.json"), config)
  writeFileSync(join(root, "leaf/main.vibe"), "export const n = 1\n")
  const result = spawnSync(binary, ["--build", "--fix", "tsconfig.json", "--pretty", "false"], {cwd:root, encoding:"utf8", timeout:120000})
  const output = result.stdout + result.stderr
  assert.doesNotMatch(output, /cannot be combined with --fix/)
  assert.match(output, /project leaf\/tsconfig.json \(1\/2\)/)
  assert.equal(result.status, 0, output)
  const migrated = JSON.parse(readFileSync(join(root, "leaf/tsconfig.json"), "utf8"))
  assert.equal(migrated.vibe.severities[code], "off")
  assert.equal(migrated.vibelang, undefined)
 })
}
