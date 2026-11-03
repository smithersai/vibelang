// run-seconds: 1200
// rule-evidence: docs/design/vips/0005-try-runs-effects.md#7fd3bec3d8d2998b
// VIP-5: a plain handler returning an Effect
// rule-evidence: docs/design/vips/0005-try-runs-effects.md#b3ffe53b7d84048a
// VIP-5: one test for an unrun Effect or Promise
// 24 compiler stages, each bounded to 45 seconds.
import assert from "node:assert/strict"
import { mkdtempSync,writeFileSync,symlinkSync,rmSync } from "node:fs"
import { dirname,join,resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
const here=dirname(fileURLToPath(import.meta.url)), compiler=resolve(here,"../../../built/local/tsc")
const shapes=[
 ["effect","Effect.Effect<number>",true,false],
 ["effect-union","Effect.Effect<number> | 0",true,false],
 ["promise","PromiseLike<number>",false,true],
 ["promise-union","PromiseLike<number> | undefined",false,true],
 ["any","any",false,false],["unknown","unknown",false,false],["never","never",false,false],["plain","number",false,false]
]
const problems=[]
for (const [name,type,isEffect,isPromise] of shapes) for (const family of ["catch","await","call"]) {
 const dir=mkdtempSync(join(tmpdir(),"vip-result-predicate-"))
 try {
  const source = family==="catch"
   ? 'effect function f(input: '+type+') { return Effect.fail("x") catch () => input }'
   : family==="await"
   ? 'async function f(input: '+type+') { return await input }'
   : 'declare function work(): '+type+'; effect function f() { const value = work(); return 0 }'
  writeFileSync(join(dir,"main.vibe"),source)
  writeFileSync(join(dir,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"es2022",lib:["esnext","dom"],module:"esnext",moduleResolution:"bundler",strict:true,types:[],outDir:"out"},include:["*.vibe"]}))
  symlinkSync(join(here,"node_modules"),join(dir,"node_modules"),"dir")
  const result=spawnSync(compiler,["-p",dir,"--pretty","false"],{encoding:"utf8",timeout:45000})
  assert.ifError(result.error)
  const output=result.stdout+result.stderr, expected={
   EK0508:family==="catch"&&isEffect,
   EK0507:family==="catch"&&isPromise,
   EK0103:family==="await"&&isEffect,
   EK0404:family==="call"&&isPromise
  }
  for (const [code,wanted] of Object.entries(expected)) if (output.includes(code)!==wanted) problems.push(name+"/"+family+"/"+code+" expected "+wanted)
  const error=(family==="catch"&&isPromise)||(family==="await"&&isEffect)||(family==="call"&&isPromise)
  if ((result.status!==0)!==error) problems.push(name+"/"+family+"/exit="+result.status+" expectedError="+error)
 } finally { rmSync(dir,{recursive:true,force:true}) }
}
assert.deepEqual(problems,[])
console.log("result predicate: 24 effect/promise union and top/bottom controls")
