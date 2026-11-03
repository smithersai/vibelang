// run-seconds: 150
// rule-evidence: docs/design/vips/0005-try-runs-effects.md#157b480f6ad08578
// VIP-5: warning repairs keep the source callable's context
// rule-evidence: docs/design/vips/0005-try-runs-effects.md#4b01e6b7d98e26e5
// VIP-5: In an ordinary async function, the explicit-bridge rule of VIP-1
// rule-evidence: docs/design/vips/0005-try-runs-effects.md#7c4631ae1b9fcfd1
// VIP-5: Async-context repair receipt: EK4609 retains native await behavior and its
// rule-evidence: docs/design/vips/0005-try-runs-effects.md#a7ceef43445f1325
// VIP-5: Async-context repair receipt: EK4610 retains native await behavior and its
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
const here = dirname(fileURLToPath(import.meta.url))
const compiler = resolve(here,"../../../built/local/tsc")
function fixed(source, check) {
  const dir = mkdtempSync(join(tmpdir(),"vip-coverage-fix-"))
  try {
    writeFileSync(join(dir,"main.vibe"),source)
    writeFileSync(join(dir,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"es2022",lib:["esnext","dom"],module:"esnext",moduleResolution:"bundler",strict:true,types:[],outDir:"out"},include:["*.vibe"]}))
    writeFileSync(join(dir,"package.json"),'{"type":"module"}')
    symlinkSync(join(here,"node_modules"),join(dir,"node_modules"),"dir")
    const result = spawnSync(compiler,["-p",dir,"--fix","--pretty","false"],{encoding:"utf8",timeout:120000})
    assert.ifError(result.error)
    check(readFileSync(join(dir,"main.vibe"),"utf8"),result)
  } finally { rmSync(dir,{recursive:true,force:true}) }
}


const source=`import { Fiber, Deferred } from "effect"
export async function waitFiber(f: Fiber.Fiber<number>) { return await f }
export async function waitDeferred(d: Deferred.Deferred<number>) { return await d }
`
fixed(source,(after,result)=>{
 const output=result.stdout+result.stderr
 assert.equal(result.status,0,output)
 assert.match(after,/async function waitFiber/)
 assert.match(after,/async function waitDeferred/)
 assert.doesNotMatch(after,/return\s+join\s|return\s+try\s+Deferred/)
 // A repair may be withheld when intent cannot be established; any offered
 // source or diagnostic repair must use the existing explicit Promise bridge.
 for (const api of ["Fiber.join","Deferred.await"]) {
  assert.ok(after.includes(api)||output.includes(api),"missing context-preserving "+api+" repair")
 }
 assert.ok(after.includes("runPromise")||output.includes("runPromise"),"async repair must use runPromise")
})
console.log("await Fiber and Deferred repairs retain their async context")
