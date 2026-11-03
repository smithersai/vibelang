import assert from "node:assert/strict"
import {cpSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from "node:fs"
import {createRequire} from "node:module"
import {tmpdir} from "node:os"
import {dirname,join} from "node:path"
import {fileURLToPath} from "node:url"
import {spawnSync} from "node:child_process"
import {test} from "node:test"
import {addSourceChildLoaders} from "../lib/source-children.mjs"
import {sameGeneratedCode} from "../lib/generated-helper-shape.mjs"
import {checkProperty} from "../../../../scripts/testing/property.mjs"
import * as vibePrettier from "../../../../packages/compiler/prettier.mjs"
const repo=fileURLToPath(new URL("../../../../",import.meta.url))
const require=createRequire(join(repo,"packages/runtime/package.json"))
const policyRequire=createRequire(join(repo,".smithers/package.json"))
const ts=require("typescript"),fc=require("fast-check"),prettier=policyRequire("prettier")
const corpus=JSON.parse(readFileSync(new URL("./corpus/opencode-formatted-source-child.json",import.meta.url),"utf8"))
const format=(source,javascript=false,options={})=>prettier.format(source,{semi:false,printWidth:120,plugins:[vibePrettier],filepath:javascript?"launcher.mjs":"launcher.ts",...options})
function witness(input) {
 const data=input.javascript?corpus.javascript:corpus.typescript
 const suffix=input.index?String(input.index+1):""
 const helper="__vibelangSourceChild"+suffix
 const entry=input.needed?"entry":'"entry.js"'
 const native='import { spawnSync } from "node:child_process"\n\nexport function launch(command'+(input.javascript?"":": string")+', entry'+(input.javascript?"":": string")+') { return spawnSync(command, ['+entry+']) }\n'
 let generated=data.imports.join("\n")+"\n"+native.replace("spawnSync(command, ["+entry+"])", "spawnSync(...__vibelangSourceChild(command, ["+entry+"]))")+"\n"+data.helper
 generated=generated.replaceAll("__vibelangSourceChild",helper).replaceAll("__vibelangFileURLToPath","__vibelangFileURLToPath"+suffix).replaceAll("__vibelangSchema","__vibelangSchema"+suffix)
 return {native,generated,helper}
}
function policy(text,javascript=false) {
 const root=mkdtempSync(join(tmpdir(),"opencode-formatter-policy-"))
 try{
  cpSync(new URL("./fixtures/opencode-native-policy",import.meta.url),root,{recursive:true})
  symlinkSync(join(repo,".smithers/node_modules"),join(root,"node_modules"),"dir")
  const file=join(root,javascript?"launcher.mjs":"launcher.ts");writeFileSync(file,text)
  const cli=join(dirname(policyRequire.resolve("oxlint")),"../bin/oxlint")
  const result=spawnSync(process.execPath,[cli,"--config",join(root,"config.json"),"--format","json",file],{cwd:root,encoding:"utf8",timeout:30000,maxBuffer:8<<20})
  assert.equal(result.status,0,result.stdout+result.stderr)
  return JSON.parse(result.stdout).diagnostics
 }finally{rmSync(root,{recursive:true,force:true})}
}
function startup(text) {
 const root=mkdtempSync(join(tmpdir(),"opencode-formatted-install-"))
 try{
  writeFileSync(join(root,"package.json"),'{"type":"module"}')
  writeFileSync(join(root,"postinstall.mjs"),text)
  return spawnSync(process.execPath,[join(root,"postinstall.mjs")],{cwd:root,encoding:"utf8",timeout:10000})
 }finally{rmSync(root,{recursive:true,force:true})}
}
test("opencode uses the captured Prettier version and only the Vibe parser plugin",()=>{
 assert.equal(prettier.version,corpus.prettier.version)
 assert.deepEqual(Object.keys(vibePrettier.parsers),["vibelang"])
})
test("needed benchmark helper stays clean after unchanged native Prettier and lint policy",async()=>{
 const sample=witness({javascript:false,needed:true,index:0})
 const before=await format(sample.generated)
 assert.deepEqual(policy(await format(sample.native)),[])
 assert.deepEqual(policy(before),[],"the captured helper alone introduces no spacing finding")
 const result=addSourceChildLoaders(before,ts,{file:"launcher.ts"})
 assert.deepEqual(result.refusals,[])
 assert.equal(result.usesChild,true)
 const formatted=await format(result.text)
 assert.deepEqual(policy(formatted),[],"generated helper must satisfy the unchanged policy after formatting")
 assert.equal(addSourceChildLoaders(formatted,ts,{file:"launcher.ts"}).text,formatted,"repeated setup after formatting is stable")
})
test("formatted unused JavaScript helper prunes and cold installed startup needs no Effect",async()=>{
 const sample=witness({javascript:true,needed:false,index:0})
 const before=await format(sample.generated,true)
 const native=await format(sample.native,true)
 assert.equal(startup(native).status,0)
 assert.notEqual(startup(before).status,0,"old generated import needs unavailable Effect")
 const result=addSourceChildLoaders(before,ts,{file:"postinstall.mjs"})
 assert.deepEqual(result.refusals,[])
 assert.equal(result.usesChild,false)
 const actual=startup(result.text)
 assert.equal(actual.status,0,actual.stderr)
 assert.equal(await format(result.text,true),native)
})
test("property: formatter choices preserve owned cleanup or required loader contracts",async()=>{
 await checkProperty(fc,{name:"opencode-formatted-source-child",rule:"Native formatting alone does not turn a canonical generated helper into an authored edit; required helpers remain usable and unnecessary helpers prune.",command:"node --test .smithers/flows/migrate/test/source-child-formatter.property.test.mjs",arbitrary:fc.record({javascript:fc.boolean(),needed:fc.boolean(),index:fc.integer({min:0,max:6}),singleQuote:fc.boolean(),printWidth:fc.constantFrom(80,100,120)}),numRuns:100,check:async input=>{
  const sample=witness(input),options={singleQuote:input.singleQuote,printWidth:input.printWidth}
  const before=await format(sample.generated,input.javascript,options)
  const file=input.javascript?"launcher.mjs":"launcher.ts"
  const result=addSourceChildLoaders(before,ts,{file})
  assert.deepEqual(result.refusals,[])
  assert.equal(result.usesChild,input.needed)
  const after=await format(result.text,input.javascript,options)
  if(!input.needed)assert.equal(after,await format(sample.native,input.javascript,options))
  assert.equal(addSourceChildLoaders(after,ts,{file}).text,after)
 }})
})
test("code, comments, documentation and helper observations remain protected",async()=>{
 const sample=witness({javascript:false,needed:false,index:0})
 for(const changed of [
  sample.generated.replace("const unchanged:","/* hand change */ const unchanged:"),
  sample.generated.replace("at < values.length","at <= values.length"),
  sample.generated.replace("args: readonly string[]","args: string[]"),
  sample.generated+"\nexport {__vibelangSourceChild};\n",
  sample.generated+"\n// authored trailing note\n",
 ]){
  const before=await format(changed)
  const result=addSourceChildLoaders(before,ts,{file:"launcher.ts"})
  assert.equal(result.text,before)
  assert.ok(result.refusals.length)
 }
})

test("property: canonical ownership admits formatting and rejects code or comment mutations",async()=>{
 await checkProperty(fc,{name:"opencode-generated-helper-ownership",rule:"Formatter trivia preserves canonical ownership; changed operators, values, types, comments or JSDoc binding sites do not.",command:"node --test .smithers/flows/migrate/test/source-child-formatter.property.test.mjs",arbitrary:fc.record({value:fc.integer({min:1,max:999}),singleQuote:fc.boolean(),printWidth:fc.constantFrom(80,120)}),numRuns:200,check:async input=>{
  const code='function __vibelangSourceChild(arg: number) { /* owned boundary */ const n = arg + '+input.value+'; return n > 0 ? "ok" : "no" }'
  const formatted=await format(code,false,{singleQuote:input.singleQuote,printWidth:input.printWidth})
  assert.ok(sameGeneratedCode(code,formatted,ts))
  for(const changed of [
   code.replace("arg +","arg -"),
   code.replace(String(input.value)+";",String(input.value+1)+";"),
   code.replace("arg: number","arg: string"),
   code.replace("owned boundary","authored change"),
   code.replace("return n","return\n n"),
  ])assert.equal(sameGeneratedCode(changed,formatted,ts),false,changed)
 }})
 const attached='/** @param {string} value */ function __vibelangSourceChild(value) { const n = value; return n }'
 const moved='function __vibelangSourceChild(value) { /** @param {string} value */ const n = value; return n }'
 assert.equal(sameGeneratedCode(attached,moved,ts),false)
})

test("unary, increment and type-operator edits are not formatter trivia",async()=>{
 const source='function __vibelangSourceChild(args: readonly string[]) { let i = 0; for (; i < args.length; i++) { if (!args[i]) return i } return i }'
 const formatted=await format(source)
 assert.ok(sameGeneratedCode(source,formatted,ts))
 for(const changed of [
  source.replace("i++","i--"),
  source.replace("!args[i]","~args[i]"),
  source.replace("readonly string[]","keyof string[]"),
  source.replace("i < args.length","i <= args.length"),
  source.replace("i++","++i"),
 ])assert.equal(sameGeneratedCode(changed,formatted,ts),false,changed)
})
