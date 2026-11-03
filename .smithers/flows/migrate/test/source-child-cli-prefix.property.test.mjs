import assert from "node:assert/strict"
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs"
import {createRequire} from "node:module"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {spawnSync} from "node:child_process"
import {test} from "node:test"
import {pathToFileURL} from "node:url"
import {addSourceChildLoaders,wireSourceChildren} from "../lib/source-children.mjs"
import {checkProperty} from "../../../../scripts/testing/property.mjs"
const require=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))
const ts=require("typescript"),fc=require("fast-check")
const corpus=JSON.parse(readFileSync(new URL("./corpus/opencode-npm-postinstall-no-source.json",import.meta.url),"utf8"))
const run=(text,extra="")=>{
 const root=mkdtempSync(join(tmpdir(),"opencode-installed-cli-prefix-"))
 try{
  writeFileSync(join(root,"package.json"),JSON.stringify({name:"opencode-offline-postinstall-control",type:"module"}))
  writeFileSync(join(root,"postinstall.mjs"),text+extra)
  return spawnSync(process.execPath,[join(root,"postinstall.mjs")],{cwd:root,encoding:"utf8",timeout:10000})
 }finally{rmSync(root,{recursive:true,force:true})}
}
test("opencode minimized installed startup has no Effect or loader dependency",()=>{
 const native=run(corpus.source)
 assert.equal(native.status,0,native.stderr)
 const result=addSourceChildLoaders(corpus.source,ts,{file:"postinstall.mjs"})
 const after=run(result.text)
 assert.equal(after.status,0,after.stderr)
 assert.equal(result.text,corpus.source)
 assert.equal(result.usesChild,false)
 assert.deepEqual(result.refusals,[])
})
test("a known JavaScript program keeps dynamic program arguments native",()=>{
 for(const entry of ["tool.js","cli.mjs","worker.cjs","main.d.ts","main.d.vibe.ts"]){
  const source='import {spawnSync} from "node:child_process"; export const launch = args => spawnSync(process.execPath,['+JSON.stringify(entry)+',...args]);\n'
  const result=addSourceChildLoaders(source,ts,{file:"launch.mjs"})
  assert.equal(result.text,source);assert.equal(result.usesChild,false)
 }
})
test("unknown program entries, mutable/shared tuples and shadowed process retain preloads",()=>{
 const negative=[
  corpus.source.replace('npm-cli.js','entry.ts'),
  corpus.source.replace('["npm"]','["node","entry.ts"]'),
  corpus.source.replace('export function install', 'cli[1] = "entry.ts";\nexport function install'),
  corpus.source.replace('const cli =','export const cli ='),
  'Array.prototype.slice = () => ["entry.vibe"];\n'+corpus.source,
  'String.prototype.endsWith = () => true;\n'+corpus.source,
  'Object.defineProperty(process, "env", {value:{npm_execpath:"entry.ts"}});\n'+corpus.source,
  corpus.source.replace('const cli =','const process = {env:{npm_execpath:{endsWith:()=>true}},execPath:"node"};\nconst cli ='),
  'import {spawnSync} from "node:child_process"; export const run = (entry,args) => spawnSync("node",[entry,...args]);\n',
  'import {spawnSync} from "node:child_process"; export const run = args => spawnSync("bun",["run",...args]);\n'
 ]
 for(const source of negative){
  const result=addSourceChildLoaders(source,ts,{file:"postinstall.mjs"})
  assert.equal(result.usesChild,true,source)
 }
})
test("property: JavaScript CLI prefixes remain native with arbitrary argument tails",async()=>{
 await checkProperty(fc,{name:"opencode-cli-prefix-source-child",rule:"A proven JavaScript CLI program does not need a VibeLang loader merely because later program arguments are dynamic.",command:"node --test .smithers/flows/migrate/test/source-child-cli-prefix.property.test.mjs",arbitrary:fc.record({entry:fc.constantFrom("npm-cli.js","yarn.mjs","pnpm.cjs"),env:fc.constantFrom("npm_execpath","TOOL_ENTRY","JS_CLI"),tuple:fc.constantFrom("cli","runner","command"),name:fc.string({maxLength:24})}),numRuns:160,check:input=>{
  const source=corpus.source.replaceAll("npm-cli.js",input.entry).replaceAll("npm_execpath",input.env).replaceAll("cli[",input.tuple+"[").replaceAll("cli.slice",input.tuple+".slice").replaceAll("const cli =", "const "+input.tuple+" =")
  const result=addSourceChildLoaders(source,ts,{file:"postinstall.mjs"})
  assert.equal(result.text,source)
  assert.equal(result.usesChild,false)
  assert.deepEqual(result.refusals,[])
  // No subprocess runs: this is the installed module's cold import contract.
  const child=run(result.text+"\nexport const witness="+JSON.stringify(input.name)+";\n")
  assert.equal(child.status,0,child.stderr)
 }})
})

test("full setup removes its old npm wrapper without adding installed-package dependencies",()=>{
 const legacy=addSourceChildLoaders(corpus.source.replace("npm-cli.js","entry.ts"),ts,{file:"postinstall.mjs"}).text.replace('endsWith("entry.ts")','endsWith("npm-cli.js")')
 const root=mkdtempSync(join(tmpdir(),"opencode-postinstall-wire-"))
 try{
  const manifest=JSON.stringify({name:"opencode-installed-postinstall",type:"module",scripts:{postinstall:"node postinstall.mjs"}})
  writeFileSync(join(root,"package.json"),manifest)
  writeFileSync(join(root,"postinstall.mjs"),legacy)
  const writes=[]
  const args={root,all:["package.json","postinstall.mjs"],manifests:["package.json"],ts,specsFor:()=>({}),write:(file,text)=>{writes.push(file);writeFileSync(join(root,file),text)}}
  assert.deepEqual(wireSourceChildren(args).warnings,[])
  const next=readFileSync(join(root,"postinstall.mjs"),"utf8")
  assert.equal(next,corpus.source)
  assert.deepEqual(writes,["postinstall.mjs"])
  assert.equal(readFileSync(join(root,"package.json"),"utf8"),manifest)
  assert.equal(run(next).status,0)
  writes.length=0;wireSourceChildren(args);assert.deepEqual(writes,[])
 }finally{rmSync(root,{recursive:true,force:true})}
})
test("property: omitting a loader agrees with the actual runtime helper for argv prefixes",async()=>{
 const template=readFileSync(new URL("../templates/source-child.ts",import.meta.url),"utf8")
 const schema=pathToFileURL(require.resolve("effect/Schema")).href
 const js=ts.transpileModule(template+"\nexport {__vibelangSourceChild};",{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replaceAll('"effect/Schema"',JSON.stringify(schema))
 const helper=(await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"))).__vibelangSourceChild
 const token=fc.constantFrom("--import","--require","--watch","--env-file","--eval","--test","--","run","cli.js","entry.ts","entry.vibe","--require=cli.js","--mystery","main.d.ts","--conditions=x","--watch=false","-r","-C","--preload=entry.ts")
 await checkProperty(fc,{name:"opencode-cli-prefix-runtime-oracle",rule:"Whenever static setup omits its helper, the original runtime helper must return the identical command and argv for native runtime options and dynamic program arguments.",command:"node --test .smithers/flows/migrate/test/source-child-cli-prefix.property.test.mjs",arbitrary:fc.record({prefix:fc.array(token,{maxLength:7}),tail:fc.array(token,{maxLength:6}),runtime:fc.constantFrom("node","nodejs","bun","/usr/bin/node","node.exe")}),numRuns:400,check:input=>{
  const source='import {spawnSync} from "node:child_process"; export const launch = args => spawnSync('+JSON.stringify(input.runtime)+',['+input.prefix.map(JSON.stringify).join(",")+(input.prefix.length?",":"")+'...args]);\n'
  const result=addSourceChildLoaders(source,ts,{file:"launch.mjs"})
  if(result.usesChild)return
  assert.equal(result.text,source)
  const args=[...input.prefix,...input.tail]
  const actual=helper(input.runtime,args,()=>{throw new Error("omitted helper would have installed a source loader")})
  assert.equal(actual[0],input.runtime)
  assert.equal(actual[1],args)
 }})
})
