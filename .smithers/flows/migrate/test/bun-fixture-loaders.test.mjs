import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { wireBunTests } from "../lib/wire.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-bun-fixture-cwd.json", import.meta.url)))
const specsFor = () => ({ vibelang: "0.0.11" })
function fixture() {
 const root = mkdtempSync(join(tmpdir(),"alchemy-bun-fixture-"))
 const put = (file,text) => { mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),text) }
 put("package.json",'{"type":"module","private":true}')
 put("test/Test/Bun.test.ts",corpus.launcher)
 put("test/Test/fixtures/guard.fixture.ts",corpus.entry)
 put("test/Test/fixtures/bunfig.toml",corpus.bunfig)
 put("test/Test/fixtures/existing.ts","export {};\n")
 put("src/value.ts","export const value = 42;\n")
 return {root,put,read:file=>readFileSync(join(root,file),"utf8"),dispose:()=>rmSync(root,{recursive:true,force:true})}
}
const wire = (f,sources=["src"]) => wireBunTests({root:f.root,packages:[{dir:".",sources}],ts,specsFor})
test("Alchemy Bun fixture children get a cwd-local test preload and a written-file receipt",()=>{
 const f=fixture()
 try{
  const result=wire(f)
  assert.deepEqual(result.warnings,[])
  assert.equal(f.read("test/Test/fixtures/bunfig.toml"),corpus.bunfig.replace('preload = [','preload = ["vibelang/bun", '))
  assert.ok(result.changed.includes("test/Test/fixtures/bunfig.toml"))
  assert.equal(JSON.parse(f.read("package.json")).devDependencies.vibelang,"0.0.11")
  assert.equal(f.read("test/Test/Bun.test.ts"),corpus.launcher)
  assert.equal(f.read("test/Test/fixtures/guard.fixture.ts"),corpus.entry)
  assert.deepEqual(wire(f).changed,[])
 }finally{f.dispose()}
})
test("a fixture with no converted or selected source in reach stays byte-identical",()=>{
 const f=fixture()
 try{
  const before=f.read("package.json"),result=wire(f,["elsewhere"])
  assert.deepEqual(result.changed,[])
  assert.deepEqual(result.warnings,[])
  assert.equal(f.read("package.json"),before)
  assert.equal(f.read("test/Test/fixtures/bunfig.toml"),corpus.bunfig)
 }finally{f.dispose()}
})
test("a fixture with no bunfig gains only its test loader",()=>{
 const f=fixture()
 try{
  rmSync(join(f.root,"test/Test/fixtures/bunfig.toml"))
  wire(f)
  assert.equal(f.read("test/Test/fixtures/bunfig.toml"),'[test]\npreload = ["vibelang/bun"]\n')
 }finally{f.dispose()}
})
test("dynamic cwd and a shadowed Bun never guess or edit a test",()=>{
 for(const shadow of [false,true]){
  const f=fixture()
  try{
   const source=shadow ? 'export function f(Bun) { return Bun.spawn(["bun","test","./guard.fixture.ts"],{cwd:"test/Test/fixtures"}) }\n'
    : corpus.launcher.replace("cwd: fixturesDir","cwd: chooseCwd()")
   f.put("test/Test/Bun.test.ts",source)
   const result=wire(f)
   assert.equal(f.read("test/Test/Bun.test.ts"),source)
   assert.equal(f.read("test/Test/fixtures/bunfig.toml"),corpus.bunfig)
   assert.deepEqual(result.changed,[])
   if(!shadow)assert.ok(result.warnings.some(w=>w.includes("Bun.test.ts:")&&w.includes("cwd")),result.warnings)
  }finally{f.dispose()}
 }
})
test("property: URL aliases, path joins, child API shapes and odd fixture names preserve existing options",()=>{
 fc.assert(fc.property(fc.constantFrom("url","path","literal"),fc.boolean(),fc.boolean(),fc.constantFrom("fixtures","space fixtures","λ-fixtures"),(style,object,sync,name)=>{
  const f=fixture()
  try{
   const path="test/Test/"+name
   f.put(path+"/guard.fixture.ts",corpus.entry)
   f.put(path+"/bunfig.toml",corpus.bunfig)
   const head=style==="url"?'import {fileURLToPath as fromURL} from "node:url";\nconst cwd=fromURL(new URL('+JSON.stringify("./"+name+"/")+',import.meta.url));\n'
    :style==="path"?'import * as p from "node:path";\nconst cwd=p.join(import.meta.dirname,'+JSON.stringify(name)+');\n'
    :'const cwd='+JSON.stringify(path)+';\n'
   const api="Bun."+(sync?"spawnSync":"spawn")
   const cmd='["bun","test","./guard.fixture.ts"]'
   const source=head+api+"("+(object?'{cmd:'+cmd+',cwd,stdout:"pipe"}':cmd+',{cwd,stdout:"pipe"}')+");\n"
   f.put("test/Test/Bun.test.ts",source)
   const result=wire(f)
   assert.deepEqual(result.warnings,[])
   assert.equal(f.read(path+"/bunfig.toml"),corpus.bunfig.replace('preload = [','preload = ["vibelang/bun", '))
   assert.equal(f.read("test/Test/Bun.test.ts"),source)
   assert.ok(result.changed.includes(path+"/bunfig.toml"))
   assert.deepEqual(wire(f).changed,[])
  }finally{f.dispose()}
 }),{seed:561171,numRuns:36})
})

test("a test's foreign submodule fixture is not rewritten",()=>{
 const f=fixture()
 try{
  f.put(".gitmodules",'[submodule "foreign-fixture"]\npath = test/Test/fixtures\n')
  const result=wire(f)
  assert.deepEqual(result.changed,[])
  assert.ok(result.warnings.some(w=>w.includes("foreign submodule")))
  assert.equal(f.read("test/Test/fixtures/bunfig.toml"),corpus.bunfig)
 }finally{f.dispose()}
})

test("real Bun fixture load fails without the preload and passes after setup",()=>{
 const repo=fileURLToPath(new URL("../../../../",import.meta.url))
 const native=join(repo,"packages/compiler/native/vibelang")
 assert.ok(existsSync(native),"build the native compiler before this fixture loader test")
 assert.equal(spawnSync("bun",["--version"],{encoding:"utf8"}).status,0)
 const f=fixture()
 try{
  f.put("tsconfig.json",JSON.stringify({compilerOptions:{target:"ES2022",module:"ESNext",moduleResolution:"Bundler",strict:true,skipLibCheck:true},include:["src/**/*.vibe"]}))
  rmSync(join(f.root,"src/value.ts"))
  f.put("src/value.vibe","export effect function value() { return 42 }\n")
  const source='import {test,expect} from "bun:test"; import * as Effect from "effect/Effect"; import {value} from "../../../src/value.vibe"; test("native",()=>{expect(Effect.runSync(value())).toBe(42)});\n'
  f.put("test/Test/fixtures/guard.fixture.ts",source)
  mkdirSync(join(f.root,"node_modules"))
  symlinkSync(join(repo,"packages/compiler"),join(f.root,"node_modules/vibelang"),"dir")
  symlinkSync(join(repo,"packages/runtime"),join(f.root,"node_modules/vibelang-runtime"),"dir")
  symlinkSync(realpathSync(join(repo,"experiments/node_modules/effect")),join(f.root,"node_modules/effect"),"dir")
  const cwd=join(f.root,"test/Test/fixtures")
  const env={...process.env,VIBELANG_BINARY:native,VIBELANG_RUNTIME:join(repo,"packages/runtime"),VIBELANG_PROJECT:join(f.root,"tsconfig.json"),VIBELANG_CACHE_DIR:join(f.root,".cache/vibelang")}
  const before=spawnSync("bun",["test","./guard.fixture.ts"],{cwd,env,encoding:"utf8",timeout:30000})
  assert.notEqual(before.status,0,"unconfigured fixture unexpectedly loaded native syntax")
  const result=wire(f)
  assert.deepEqual(result.warnings,[])
  const after=spawnSync("bun",["test","./guard.fixture.ts"],{cwd,env,encoding:"utf8",timeout:30000})
  assert.equal(after.status,0,after.stderr+"\n"+after.stdout)
  assert.equal(f.read("test/Test/fixtures/guard.fixture.ts"),source)
  assert.equal(f.read("test/Test/Bun.test.ts"),corpus.launcher)
 }finally{f.dispose()}
})
