import assert from "node:assert/strict"
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from "node:fs"
import {createRequire} from "node:module"
import {tmpdir} from "node:os"
import {dirname,join,resolve} from "node:path"
import {spawnSync} from "node:child_process"
import {test} from "node:test"
import {addCompilerScripts} from "../lib/wire.mjs"
import {SpecPath} from "../../../../scripts/testing/spec-path.mjs"

const require=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))
const ts=require("typescript"),fc=require("fast-check"),repo=resolve(new URL("../../../../",import.meta.url).pathname)
const compiler=process.env.VIBELANG_BINARY||join(repo,"packages/compiler/native/vibelang")
const bun=process.env.VIBELANG_TEST_BUN||"bun"
test("TestBunBuildProjectRulesQuoted",()=>{
  const chapter=readFileSync(SpecPath("007-tooling.md"),"utf8")
  for(const quote of ["Fields retain their TypeScript meaning with one deliberate file-kind exception:","Module resolution is as in TypeScript"])assert.ok(chapter.includes(quote))
})
const quote=word=>"'"+word.replaceAll("'","'\\''")+"'"
function check({longBuild,longProject,projectFirst,space,depth,noEmit,nodeNext}){
  const root=mkdtempSync(join(tmpdir(),"migrate-bun-project-"))
  const project=(space?"project -p name":"project")+"/"+"nested/".repeat(depth)+"tsconfig.tests.json"
  const home=dirname(project),module=nodeNext?"NodeNext":"ESNext"
  const config={compilerOptions:{strict:true,types:[],target:"ES2022",module,moduleResolution:nodeNext?"NodeNext":"Bundler",composite:true,declaration:true,noEmit,rootDir:"src",outDir:"dist"},include:["src"],vibe:{effectGlobals:false,effectModules:false,sidecarDir:".vibe/declarations"}}
  const put=(side,name,text)=>{const file=join(root,side,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text)}
  const main='import {value} from "./leaf'+(nodeNext?".js":"")+'"; export const output: number=value;\n'
  const mode=longBuild?"--build":"-b",selector=longProject?"--project":"-p"
  const args=projectFirst?[selector,project,mode]:[mode,selector,project]
  try{
    for(const side of ["native","migrated"]){
      put(side,"package.json",'{"type":"module"}')
      put(side,"tsconfig.json",JSON.stringify({compilerOptions:{strict:true,types:[],noEmit:true},files:["ignored.ts"]}))
      put(side,"ignored.ts",'export const ignored: number="outside selected project";\n')
      put(side,project,JSON.stringify(config))
      put(side,home+"/src/main.ts",main)
      put(side,home+"/src/leaf"+(side==="native"?".ts":".vibe"),"export const value=42;\n")
    }
    const native=join(root,"native"),migrated=join(root,"migrated")
    const bunRun=()=>spawnSync(bun,["check","--no-script",...args],{cwd:native,encoding:"utf8",timeout:60000})
    const first=bunRun();assert.ifError(first.error);assert.equal(first.status,0,first.stdout+first.stderr)
    const messages=[],host=ts.createSolutionBuilderHost(ts.sys,undefined,d=>messages.push(d))
    const stock=()=>ts.createSolutionBuilder(host,[join(native,project)],{force:true}).build()
    assert.equal(stock(),0,JSON.stringify(messages.map(d=>d.code)))
    if(!longBuild&&!longProject&&!projectFirst&&space&&depth===1&&noEmit&&!nodeNext){
      const tsc=require.resolve("typescript/lib/tsc.js")
      const valid=spawnSync(process.execPath,[tsc,"-b",project,"--force","--pretty","false"],{cwd:native,encoding:"utf8",timeout:60000})
      assert.ifError(valid.error);assert.equal(valid.status,0,valid.stdout+valid.stderr)
      const invalid=spawnSync(process.execPath,[tsc,"-b","-p",project,"--pretty","false"],{cwd:native,encoding:"utf8",timeout:60000})
      assert.ifError(invalid.error);assert.notEqual(invalid.status,0);assert.match(invalid.stdout+invalid.stderr,/TS5072/)
      for(const flag of ["--strict","--skipLibCheck"]){
        const unsupported=spawnSync(process.execPath,[tsc,"-b",project,flag,"--pretty","false"],{cwd:native,encoding:"utf8",timeout:60000})
        assert.ifError(unsupported.error);assert.notEqual(unsupported.status,0,"TypeScript build flag "+flag)
      }
      console.log("stock tsc "+ts.version+": -b project exits0; -b -p project reports TS5072")
    }
    mkdirSync(join(migrated,"node_modules/.bin"),{recursive:true});symlinkSync(compiler,join(migrated,"node_modules/.bin/vibelang"))
    const words=projectFirst?[selector+" "+quote(project),mode]:[mode,selector+" "+quote(project)]
    const original="bun check --no-script "+words.join(" "),pkg=addCompilerScripts({scripts:{typecheck:original}},"unused")
    const run=()=>spawnSync("sh",["-c",pkg.scripts.typecheck+" --force --pretty false"],{cwd:migrated,encoding:"utf8",timeout:60000,env:{...process.env,PATH:join(migrated,"node_modules/.bin")+":"+process.env.PATH,GOMAXPROCS:"2"}})
    const actual=run();assert.ifError(actual.error);assert.equal(actual.status,0,actual.stdout+actual.stderr+original)
    for(const side of ["native","migrated"])assert.equal(existsSync(join(root,side,home,"dist/main.js")),!noEmit)
    assert.equal(readFileSync(join(migrated,home,"src/main.ts"),"utf8"),main)
    put("native",home+"/src/main.ts",main.replace("output: number","output: string"))
    put("migrated",home+"/src/main.ts",main.replace("output: number","output: string"))
    const nativeBad=bunRun();assert.notEqual(nativeBad.status,0,"selected Bun project errors remain visible")
    assert.notEqual(stock(),0,"selected TypeScript project errors remain visible")
    const bad=run();assert.ifError(bad.error);assert.notEqual(bad.status,0);assert.match(bad.stdout+bad.stderr,/TS2322/)
  }finally{rmSync(root,{recursive:true,force:true})}
}
test("opencode Core build-project corpus matches native Bun and stock TypeScript",()=>{
  const corpus=JSON.parse(readFileSync(new URL("./corpus/opencode-core-bun-build-project.json",import.meta.url)))
  assert.equal(corpus.script,"bun check --no-script -b -p tsconfig.tests.json")
  for(const longBuild of [false,true])for(const longProject of [false,true])check({longBuild,longProject,projectFirst:false,space:true,depth:1,noEmit:true,nodeNext:false})
  console.log("stock TypeScript "+ts.version+": 4 native Bun/TypeScript/Vibe project-selection twins, default-project errors excluded; selected-project negatives rejected")
})
test("property: build project flags retain quoted paths, order, resolution and emission",()=>{
  fc.assert(fc.property(fc.record({longBuild:fc.boolean(),longProject:fc.boolean(),projectFirst:fc.boolean(),space:fc.boolean(),depth:fc.integer({min:0,max:2}),noEmit:fc.boolean(),nodeNext:fc.boolean()}),check),{seed:507246,numRuns:12})
})
