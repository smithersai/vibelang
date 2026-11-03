// run-seconds: 900
// rule-evidence: docs/design/vips/0004-throw.md#151464b7b659c2f1
// VIP-4: Settles the open async question in the 2026-10-31 "plain functions
// rule-evidence: docs/design/vips/0004-throw.md#232164530b92f3c4
// VIP-4: So the compile error covers throw in sync VibeLang functions
// Six bounded compiler stages plus a stock TypeScript syntax control.
import assert from "node:assert/strict"
import { mkdtempSync,writeFileSync,symlinkSync,rmSync } from "node:fs"
import { dirname,join,resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
const here=dirname(fileURLToPath(import.meta.url)), compiler=resolve(here,"../../../built/local/tsc")
const tsc=resolve(here,"../../../../docs/tools/node_modules/typescript/bin/tsc")
const programs=[
 ["declaration",'function f() { throw "bad" }'],
 ["arrow",'const f = () => { throw "bad" }'],
 ["constructor",'class C { constructor() { throw "bad" } }'],
 ["getter",'class C { get value(): number { throw "bad" } }'],
 ["setter",'class C { set value(n: number) { throw "bad" } }'],
 ["generator",'function* f() { throw "bad" }']
]
const dir=mkdtempSync(join(tmpdir(),"vip4-source-throw-"))
try {
 symlinkSync(join(here,"node_modules"),join(dir,"node_modules"),"dir")
 const options={target:"es2022",lib:["esnext","dom"],module:"esnext",moduleResolution:"bundler",strict:true,types:[],outDir:"out"}
 writeFileSync(join(dir,"native.json"),JSON.stringify({compilerOptions:options,include:["*.ts"]}))
 for (const [key,source] of programs) writeFileSync(join(dir,key+".ts"),source+"\nexport {}\n")
 const native=spawnSync(process.execPath,[tsc,"-p",join(dir,"native.json")],{encoding:"utf8",timeout:120000})
 assert.ifError(native.error)
 assert.equal(native.status,0,"all negative VibeLang inputs must be valid native TypeScript: "+native.stdout+native.stderr)
 writeFileSync(join(dir,"tsconfig.json"),JSON.stringify({compilerOptions:options,files:["main.vibe"]}))
 const missing=[]
 for (const [key,source] of programs) {
  writeFileSync(join(dir,"main.vibe"),source)
  const result=spawnSync(compiler,["-p",dir,"--pretty","false"],{encoding:"utf8",timeout:120000})
  assert.ifError(result.error)
  if (result.status===0||!/error (?:EK|TS)[0-9]+:/.test(result.stdout+result.stderr)) missing.push(key+" source throw compiled")
 }
 assert.deepEqual(missing,[])
} finally {rmSync(dir,{recursive:true,force:true})}
console.log("synchronous source throw rejection across six callable kinds")
