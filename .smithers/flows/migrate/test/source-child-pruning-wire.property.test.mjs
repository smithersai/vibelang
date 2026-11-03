import assert from "node:assert/strict"
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs"
import {createRequire} from "node:module"
import {tmpdir} from "node:os"
import {dirname,join} from "node:path"
import {test} from "node:test"
import {addSourceChildLoaders,wireSourceChildren} from "../lib/source-children.mjs"
import {checkProperty} from "../../../../scripts/testing/property.mjs"
const require=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))
const ts=require("typescript"),fc=require("fast-check")
const corpus=JSON.parse(readFileSync(new URL("./corpus/opencode-pruned-source-child-wire.json",import.meta.url),"utf8"))
function fixture(text,{file="shell.ts",pins="both",privatePackage=true,extra={}}={}) {
 const root=mkdtempSync(join(tmpdir(),"opencode-pruned-child-wire-"))
 const put=(file,text)=>{mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),text)}
 const manifest=JSON.stringify({name:"opencode-prune-fixture",private:privatePackage,type:"module",scripts:{probe:"bun "+file}},null,2)+"\n"
 put("package.json",manifest);put(file,text)
 for(const [path,source]of Object.entries(extra))put(path,source)
 const all=["package.json",file,...Object.keys(extra)]
 const specs=pins==="both"?{vibelang:"0.0.11",effect:"4.1.1"}:pins==="compiler"?{vibelang:"0.0.11"}:{}
 const writes=[]
 const run=()=>wireSourceChildren({root,all,manifests:["package.json"],ts,specsFor:()=>specs,write:(path,next)=>{writes.push(path);put(path,next)}})
 return {root,file,manifest,writes,run,read:()=>readFileSync(join(root,file),"utf8"),close:()=>rmSync(root,{recursive:true,force:true})}
}
function pruning(input) {
 let text=input.javascript?corpus.javascriptLegacy:corpus.legacy
 const expected=input.javascript?corpus.javascriptNative:corpus.native
 const suffix=input.index?String(input.index+1):""
 const helper="__vibelangSourceChild"+suffix
 const url=(input.namespace?"__vibelangNodeURL":"__vibelangFileURLToPath")+suffix
 text=text.replaceAll("__vibelangSourceChild",helper).replaceAll("__vibelangFileURLToPath",url)
 if(input.namespace)text=text.replace("import { fileURLToPath as "+url+" }","import * as "+url).replaceAll(url+"(",url+".fileURLToPath(")
 const f=fixture(text,{file:input.javascript?"shell.mjs":"shell.ts",pins:input.pins,privatePackage:input.privatePackage})
 try {
  const direct=addSourceChildLoaders(text,ts,{file:f.file,type:"module"})
  assert.equal(direct.usesChild,false);assert.deepEqual(direct.refusals,[])
  assert.equal(direct.text,expected,"validated transformer output")
  assert.deepEqual(f.run().warnings,[])
  assert.equal(f.read(),expected,"the full wiring stage must persist validated pruning")
  assert.deepEqual(f.writes,[f.file],"pruning needs no dependency or manifest edit")
  assert.equal(readFileSync(join(f.root,"package.json"),"utf8"),f.manifest)
  f.writes.length=0
  assert.deepEqual(f.run().warnings,[])
  assert.deepEqual(f.writes,[],"refresh is idempotent")
 } finally {f.close()}
}
test("opencode shell-env: whole setup writes pruned legacy text, without loader dependencies",()=>pruning({javascript:false,index:0,namespace:false,pins:"both",privatePackage:true}))
test("pruning needs neither a compiler pin nor an Effect dependency",()=> {
 for(const pins of ["compiler","none"])pruning({javascript:true,index:2,namespace:true,pins,privatePackage:false})
})
test("property: whole setup persists pruning across helper names, JS/TS, package roles and missing pins",async()=>{
 await checkProperty(fc,{name:"opencode-source-child-pruning-wire",rule:"Setup persists validated removal of its owned non-source child helper, leaves the native launch intact and adds no loader dependencies.",command:"node --test .smithers/flows/migrate/test/source-child-pruning-wire.property.test.mjs",arbitrary:fc.record({javascript:fc.boolean(),namespace:fc.boolean(),index:fc.integer({min:0,max:12}),pins:fc.constantFrom("both","compiler","none"),privatePackage:fc.boolean()}),numRuns:160,check:pruning})
})
test("native launches and protected test-owned launchers stay byte-identical",()=>{
 for(const [file,text]of [["shell.ts",corpus.native],["test/shell.test.ts",corpus.legacy]]) {
  const f=fixture(text,{file})
  try {f.run();assert.equal(f.read(),text);assert.deepEqual(f.writes,[])}
  finally {f.close()}
 }
})
test("observed or edited helpers retain located refusals and their original bytes",()=>{
 for(const text of [corpus.legacy+"\nexport {__vibelangSourceChild};\n",corpus.legacy.replace("const unchanged:","/* authored */ const unchanged:")]){
  const f=fixture(text)
  try {const result=f.run();assert.equal(f.read(),text);assert.ok(!f.writes.includes(f.file));assert.ok(result.warnings.some(w=>/shell.ts:\d+:/.test(w)))}
  finally{f.close()}
 }
})
test("required typed-source launchers still wait for configured dependency pins",()=>{
 const source='import {spawnSync} from "node:child_process"; export const launch = (entry: string) => spawnSync("node", [entry])\n'
 const f=fixture(source,{pins:"none"})
 try{assert.ok(f.run().warnings.some(w=>/no vibelang version/.test(w)));assert.equal(f.read(),source);assert.deepEqual(f.writes,[])}
 finally{f.close()}
})
test("generated output scripts remain outside source-child pruning",()=>{
 const f=fixture(corpus.javascriptLegacy,{file:"dist/shell.mjs",extra:{"tsconfig.json":JSON.stringify({compilerOptions:{outDir:"dist"},include:["src"]})}})
 try{f.run();assert.equal(f.read(),corpus.javascriptLegacy);assert.deepEqual(f.writes,[])}
 finally{f.close()}
})
