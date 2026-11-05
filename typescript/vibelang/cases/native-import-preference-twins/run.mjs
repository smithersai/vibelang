// run-seconds: 150
import assert from "node:assert/strict"
import {mkdtempSync,writeFileSync,readFileSync,symlinkSync,rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname,join,resolve} from "node:path"
import {fileURLToPath} from "node:url"
import {spawnSync} from "node:child_process"
import {createRequire} from "node:module"
const here=dirname(fileURLToPath(import.meta.url)),compiler=resolve(here,"../../../built/local/tsc")
const require=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))
const ts=require("typescript"),stock=require.resolve("typescript/bin/tsc")
function specifiers(text){
 const out=[],source=ts.createSourceFile("main.d.ts",text,ts.ScriptTarget.Latest,true)
 function visit(node){
  if(ts.isImportDeclaration(node))out.push(["import",node.moduleSpecifier.text])
  if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument))out.push(["type",node.argument.literal.text])
  ts.forEachChild(node,visit)
 }
 visit(source);return out
}
for(const ext of [".ts",".tsx"])for(const explicit of [false,true])for(const quote of ['"',"'"]){
 const dir=mkdtempSync(join(tmpdir(),"native-import-preference-"))
 try{
  symlinkSync(join(here,"node_modules"),join(dir,"node_modules"),"dir")
  const main='import {use} from '+quote+'./bridge'+(explicit?'.ts':'')+quote+';import {item} from '+quote+'./banners'+quote+';export interface Input{tasks:Parameters<typeof item>[0]}export function run(flag:boolean){use(1);return {now:flag?item():null}}'
  const put=(name,text)=>writeFileSync(join(dir,name),text)
  put("bridge.ts","export function use(value:number):number{return value}")
  put("view"+ext,"export interface View{readonly id:string}")
  put("banners"+ext,'import type {View} from "./view";export declare function item(input?:{tasks:readonly string[]}):View')
  put("main"+ext,main)
  const config={compilerOptions:{target:"ES2022",module:"ESNext",moduleResolution:"Bundler",jsx:"preserve",strict:true,skipLibCheck:true,declaration:true,rewriteRelativeImportExtensions:true,outDir:"out",types:[]},files:["main"+ext],vibe:{effectGlobals:false,effectModules:false}}
  put("tsconfig.json",JSON.stringify(config))
  let result=spawnSync(process.execPath,[stock,"-p",dir,"--pretty","false"],{encoding:"utf8",timeout:30000})
  assert.equal(result.status,0,result.stdout+result.stderr)
  const expected=specifiers(readFileSync(join(dir,"out/main.d.ts"),"utf8"))
  put("bridge.vibe",readFileSync(join(dir,"bridge.ts"),"utf8"));rmSync(join(dir,"bridge.ts"))
  put("main"+ext,explicit?main.replace("./bridge.ts","./bridge.vibe"):main)
  result=spawnSync(compiler,["-p",dir,"--pretty","false"],{encoding:"utf8",timeout:30000})
  assert.equal(result.status,0,result.stdout+result.stderr)
  assert.deepEqual(specifiers(readFileSync(join(dir,"out/main.d.ts"),"utf8")),expected,JSON.stringify({ext,explicit,quote}))
 }finally{rmSync(dir,{recursive:true,force:true})}
}
console.log("native import preferences match stock TypeScript")
