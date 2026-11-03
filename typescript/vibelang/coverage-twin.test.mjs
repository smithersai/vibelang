import test from "node:test"
import assert from "node:assert/strict"
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from "node:fs"
import {tmpdir} from "node:os"
import path from "node:path"
import {checkTwin} from "./test/coverage-twin.mjs"

// Negative controls: equal runtime values cannot hide wrong E/R, and equal
// declarations cannot hide a wrong runtime value.
for (const [name,slots,value,message] of [
  ["matching types and Exit","number, never, never",1,null],
  ["success type mismatch","string, never, never",1,/twin types/],
  ["error type mismatch","number, string, never",1,/twin types/],
  ["service type mismatch","number, never, {service:true}",1,/twin types/],
  ["Exit mismatch","number, never, never",2,/Exit mismatch/],
]) test(name,()=>{
  const modules=process.env.COV_MODULES_REFERENCE_NODE_MODULES??process.env.EFFECT_NODE_MODULES
  assert.ok(modules,"set EFFECT_NODE_MODULES")
  const dir=mkdtempSync(path.join(tmpdir(),"coverage-twin-"))
  try {
    for(const child of ["node_modules","out","effect"])mkdirSync(path.join(dir,child))
    symlinkSync(path.join(modules,"effect"),path.join(dir,"node_modules/effect"))
    writeFileSync(path.join(dir,"package.json"),JSON.stringify({type:"module"}))
    writeFileSync(path.join(dir,"out/main.js"),'import {Effect} from "effect";export function main(){return Effect.succeed('+value+')}')
    writeFileSync(path.join(dir,"out/main.d.ts"),'import {Effect} from "effect";export declare function main():Effect.Effect<'+slots+'>')
    writeFileSync(path.join(dir,"effect/main.ts"),'import {Effect} from "effect";export function main(){return Effect.succeed(1)}')
    if(message)assert.throws(()=>checkTwin(dir),message)
    else checkTwin(dir)
  } finally {rmSync(dir,{recursive:true,force:true})}
})
