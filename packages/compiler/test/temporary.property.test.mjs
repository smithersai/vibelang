import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,rmSync,symlinkSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {fileURLToPath,pathToFileURL} from "node:url"
import {test} from "node:test"
import fc from "fast-check"
import {checkProperty} from "../../../scripts/testing/property.mjs"

const compilerPackage=fileURLToPath(new URL("../",import.meta.url))
const rule="Existing tools work."
const corpus=new URL("./corpus/",import.meta.url)
function scenario({depth=2,state="missing",cache="default",async=false}={}) {
 const root=mkdtempSync(join(tmpdir(),"opencode-loader-temp-"))
 try {
  const requested=join(root,...Array.from({length:depth},(_,i)=>"tmp "+i)),compiler=join(root,"compiler.mjs")
  if(state==="directory")mkdirSync(requested,{recursive:true})
  if(state==="file"){mkdirSync(join(requested,".."),{recursive:true});writeFileSync(requested,"application")}
  writeFileSync(join(root,"package.json"),'{"type":"module"}')
  writeFileSync(join(root,"tsconfig.json"),'{"files":[]}')
  writeFileSync(compiler,'import {writeFileSync} from "node:fs"; writeFileSync('+JSON.stringify(join(root,"out.json"))+',JSON.stringify(process.argv[process.argv.indexOf("--outDir")+1]))\n')
  const cacheOption=cache==="off"?false:cache==="custom"?{directory:join(root,"custom-cache")}:undefined
  const source='import assert from "node:assert/strict"; import {compileProjectSync,projectBackend} from '+JSON.stringify(pathToFileURL(join(compilerPackage,"project.mjs")).href)+'; const options='+JSON.stringify({root,compiler,project:join(root,"tsconfig.json"),cache:cacheOption})+'; const backend=projectBackend(options); try {const result='+(async?'await backend.compile(options.project)':'compileProjectSync(options)')+'; assert.deepEqual(result.errors,[])}finally{await backend.close()}\n'
  const result=spawnSync(process.execPath,["--input-type=module","-e",source],{cwd:root,encoding:"utf8",env:{...process.env,TMPDIR:requested,TMP:requested,TEMP:requested,VIBELANG_CACHE_DIR:"",VIBELANG_DISABLE_CACHE:""},timeout:30000})
  assert.equal(result.status,0,result.stderr)
  assert.equal(existsSync(requested),state!=="missing","compilation never creates the application TMPDIR")
  if(state==="file")assert.equal(readFileSync(requested,"utf8"),"application")
  const output=JSON.parse(readFileSync(join(root,"out.json"),"utf8"))
  assert.equal(existsSync(output),false,"compiler scratch output is removed")
  if(state!=="directory")assert.ok(!output.startsWith(requested+"/"))
  if(cache==="off")assert.ok(!readdirSync(root).some(name=>name.startsWith("vibelang-cache-")))
 }finally{rmSync(root,{recursive:true,force:true})}
}
test("opencode-58: importing through the synchronous compiler leaves missing TMPDIR absent",()=>scenario())
test("opencode-58: asynchronous compilation also leaves missing TMPDIR absent",()=>scenario({async:true}))
test("temporary-directory oracle quotes the tooling spec",()=>assert.ok(readFileSync(new URL("../../../docs/design/src/007-tooling.md",import.meta.url),"utf8").includes(rule)))
test("property: loader compilation tolerates temporary path shapes and cache modes",async()=>checkProperty(fc,{
 name:"loader-temporary-directory",rule,command:"node --test packages/compiler/test/temporary.property.test.mjs",regressions:corpus,numRuns:40,
 arbitrary:fc.record({depth:fc.integer({min:1,max:4}),state:fc.constantFrom("missing","directory","file"),cache:fc.constantFrom("default","custom","off"),async:fc.boolean()}),check:scenario
}))
test("opencode-58: Node and Bun imports do not create application TMPDIR",()=>{
 const native=process.env.VIBELANG_BINARY??fileURLToPath(new URL("../native/vibelang",import.meta.url))
 assert.ok(existsSync(native),"build the native compiler")
 const root=mkdtempSync(join(tmpdir(),"opencode-global-import-"))
 try {
  mkdirSync(join(root,"node_modules"),{recursive:true})
  symlinkSync(compilerPackage,join(root,"node_modules/vibelang"))
  writeFileSync(join(root,"package.json"),'{"type":"module"}')
  writeFileSync(join(root,"tsconfig.json"),JSON.stringify({compilerOptions:{module:"ESNext",moduleResolution:"Bundler",target:"ES2022",types:[],noEmit:true},vibe:{effectGlobals:false,effectModules:false},files:["global.vibe"]}))
  writeFileSync(join(root,"global.vibe"),"export const value = 42\n")
  for(const engine of ["node","bun"])for(const disabled of [false,true]){
   const requested=join(root,engine+"-"+disabled,"application-tmp")
   const source='import assert from "node:assert/strict"; import {existsSync} from "node:fs"; const {value}=await import("./global.vibe"); assert.equal(value,42); assert.equal(existsSync('+JSON.stringify(requested)+'),false)'
   const args=engine==="node"?["--import","vibelang/register","--input-type=module","-e",source]:["--preload","vibelang/bun","-e",source]
   const result=spawnSync(engine,args,{cwd:root,encoding:"utf8",timeout:30000,env:{...process.env,TMPDIR:requested,TMP:requested,TEMP:requested,VIBELANG_BINARY:native,VIBELANG_CACHE_DIR:"",VIBELANG_DISABLE_CACHE:disabled?"1":""}})
   assert.equal(result.status,0,engine+": "+result.stdout+result.stderr)
   assert.equal(existsSync(requested),false)
  }
 }finally{rmSync(root,{recursive:true,force:true})}
})
