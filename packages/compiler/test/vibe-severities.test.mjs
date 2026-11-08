import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const modules = process.env.EFFECT_NODE_MODULES || join(repo,"experiments/node_modules")
const skip = !existsSync(native) || !existsSync(join(modules,"effect"))
function project(t, settings, source) {
 const dir = realpathSync(mkdtempSync(join(tmpdir(),"vibe-severities-")))
 t.after(()=>rmSync(dir,{recursive:true,force:true}))
 mkdirSync(join(dir,"node_modules"))
 symlinkSync(realpathSync(join(modules,"effect")),join(dir,"node_modules/effect"))
 symlinkSync(join(repo,"packages/runtime"),join(dir,"node_modules/vibelang-runtime"))
 writeFileSync(join(dir,"package.json"),JSON.stringify({type:"module"}))
 writeFileSync(join(dir,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"es2022",module:"nodenext",moduleResolution:"nodenext",strict:true,types:[],skipLibCheck:true,noEmitOnError:true,outDir:"dist"},files:["main.vibe"],...settings}))
 writeFileSync(join(dir,"main.vibe"),source)
 return dir
}
function run(dir,...args) {return spawnSync(native,["-p","tsconfig.json","--pretty","false",...args],{cwd:dir,encoding:"utf8"})}
const source = `import type { Fiber } from "effect"
export async function wait(fiber: Fiber.Fiber<number>) { return await fiber }
`
// Chapter 007 / Fiber warning reporting, status and noEmitOnError across four severities: docs/design/src/007-tooling.md#bc2663339d8154bc
// Chapter 007 / Fiber warning reporting, status and noEmitOnError across four severities: docs/design/src/007-tooling.md#cc7166d61cac2455
// Chapter 007 / Fiber warning reporting, status and noEmitOnError across four severities: docs/design/src/007-tooling.md#8848fe61649e9321
// Chapter 007 / Fiber warning reporting, status and noEmitOnError across four severities: docs/design/src/007-tooling.md#9a21abd24afa95c8
// Chapter 007 / Fiber warning reporting, status and noEmitOnError across four severities: docs/design/src/007-tooling.md#b6d9b844cce809ee
for (const severity of ["error","warning","suggestion","off"]) {
 test(`vibe.severities ${severity} controls CLI, status and noEmitOnError`,{skip},t=>{
  const dir=project(t,{vibe:{severities:{EK4609:severity}}},source)
  const result=run(dir)
  assert.equal(result.status===0,severity!=="error",result.stdout+result.stderr)
  assert.equal(existsSync(join(dir,"dist/main.js")),severity!=="error",result.stdout)
  if(severity==="warning" || severity==="error") assert.match(result.stdout,new RegExp(`${severity} EK4609:`))
  else assert.doesNotMatch(result.stdout,/EK4609/)
 })
}
for (const severity of ["error","warning","suggestion","off"]) {
 test(`imported EK3833 ${severity} overrides the language-service plugin`,{skip},t=>{
  const dir=project(t,{vibe:{severities:{EK3833:severity}}},`import { Effect } from "effect"
export effect function pause() { try Effect.sleep(0); return 1 }
`)
  const config = JSON.parse(readFileSync(join(dir,"tsconfig.json"),"utf8"))
  config.compilerOptions.plugins = [{name:"@effect/language-service"}]
  writeFileSync(join(dir,"tsconfig.json"),JSON.stringify(config))
  const result=run(dir,"--noEmit")
  assert.equal(result.signal,null,result.stdout+result.stderr)
  assert.equal(result.status===0,severity!=="error" && severity!=="warning",result.stdout+result.stderr)
  if(severity!=="off") assert.match(result.stdout,new RegExp(severity+" EK3833: effectSleepZeroToYieldNow: Consider "))
  else assert.doesNotMatch(result.stdout,/EK3833/)
  const lint=spawnSync(native,["lint","-p","tsconfig.json"],{cwd:dir,encoding:"utf8"})
  assert.ifError(lint.error)
  assert.equal(lint.signal,null,lint.stdout+lint.stderr)
  assert.equal(lint.status===0,severity!=="error",lint.stdout+lint.stderr)
  if(severity!=="off") assert.match(lint.stdout,new RegExp(severity+" EK3833:"))
  else assert.doesNotMatch(lint.stdout,/EK3833/)
 })
}

for (const severity of ["error","warning","suggestion","off"]) {
 // Chapter 007 / Deferred warning reporting, status and noEmitOnError: docs/design/src/007-tooling.md#b8b4de61a34046b0
test(`Deferred EK4610 ${severity} controls reporting and exit status`,{skip},t=>{
  const dir=project(t,{vibe:{severities:{EK4610:severity}}},`import type { Deferred } from "effect"
export async function wait(value: Deferred.Deferred<number>) { return await value }
`)
  const result=run(dir)
  assert.equal(result.status===0,severity!=="error",result.stdout+result.stderr)
  assert.equal(existsSync(join(dir,"dist/main.js")),severity!=="error",result.stdout)
  if(severity==="warning" || severity==="error") assert.match(result.stdout,new RegExp(`${severity} EK4610:`))
  else assert.doesNotMatch(result.stdout,/EK4610/)
 })
}

for (const inherited of [false,true]) {
 test(`modern severities ignore ${inherited ? "inherited" : "local"} retired legacy options`,{skip},t=>{
  const legacy={trustedPackages:["example-package"]}
  const settings={vibe:{severities:{EK4609:"warning"}},...(inherited?{extends:"./base.json"}:{vibelang:legacy})}
  const dir=project(t,settings,source)
  if(inherited) writeFileSync(join(dir,"base.json"),JSON.stringify({vibelang:legacy}))
  const result=run(dir,"--showConfig")
  assert.equal(result.status,0,result.stdout+result.stderr)
  const shown=JSON.parse(result.stdout)
  assert.equal(shown.compilerOptions.vibelang?.trustedPackages,undefined)
 })
}

test("empty vibe section stays modern in --showConfig",{skip},t=>{
 const dir=project(t,{vibe:{}},"export const value=1")
 const result=run(dir,"--showConfig")
 assert.equal(result.status,0,result.stdout+result.stderr)
 const shown=JSON.parse(result.stdout)
 assert.deepEqual(shown.vibe,{})
 assert.equal(shown.compilerOptions.vibelang,undefined)
})

for (const severity of ["error","warning","suggestion","off"]) {
 test(`migration EK3009 ${severity} controls reporting and exit status`,{skip},t=>{
  const dir=project(t,{vibelang:{diagnostics:{}},vibe:{severities:{EK3009:severity}}},"export const value=1")
  const result=run(dir)
  assert.equal(result.status===0,severity!=="error",result.stdout+result.stderr)
  assert.equal(existsSync(join(dir,"dist/main.js")),severity!=="error",result.stdout)
  if(severity==="warning" || severity==="error") assert.match(result.stdout,new RegExp(`${severity} EK3009:`))
  else assert.doesNotMatch(result.stdout,/EK3009/)
 })
}

for (const severity of ["error", "warning", "suggestion", "off"]) {
 test(`Appendix B lint warning EK4833 ${severity} controls CLI and emit`, {skip}, t => {
  const dir = project(t, {vibe: {severities: {EK4833: severity}}}, "export type Value = Effect.Effect<number>\n")
  const result = run(dir)
  assert.equal(result.status === 0, severity !== "error", result.stdout + result.stderr)
  assert.equal(existsSync(join(dir, "dist/main.js")), severity !== "error", result.stdout)
  assert.doesNotMatch(result.stdout, /EK3006/)
  if (severity === "warning" || severity === "error") assert.match(result.stdout, new RegExp(`${severity} EK4833:`))
  else assert.doesNotMatch(result.stdout, /EK4833/)
 })
}

test("invalid child severity falls back without restoring the base error", { skip }, t => {
 const dir = project(t, { extends: "./base.json", vibe: { severities: { EK4609: 42, EK4610: "off" } } },
  `import type { Deferred, Fiber } from "effect"
export async function wait(fiber: Fiber.Fiber<number>, deferred: Deferred.Deferred<number>) {
 await deferred
 return await fiber
}
`)
 writeFileSync(join(dir, "base.json"), JSON.stringify({
  vibe: { severities: { EK4609: "error", EK4610: "error" } }
 }))
 const result = run(dir)
 assert.equal(result.error, undefined)
 assert.notEqual(result.status, 0, result.stdout + result.stderr)
 assert.match(result.stdout, /error EK3006:/)
 assert.match(result.stdout, /warning EK4609:/)
 assert.doesNotMatch(result.stdout, /error EK4609:|EK4610:/)
 assert.equal(existsSync(join(dir, "dist/main.js")), false, "config error must honor noEmitOnError")
})

// Chapter 007 / effective severity precedence uses language-service fallback: docs/design/src/007-tooling.md#73ed4cbf7ac90fad
// Chapter 007 / effective severity precedence uses language-service fallback: docs/design/src/007-tooling.md#9434e720f6424fad
test("invalid inherited lint severity uses the language-service setting", { skip }, t => {
 const dir = project(t, { extends: "./base.json", vibe: { severities: { EK3833: null } } },
  `import { Effect } from "effect"
export effect function pause() { try Effect.sleep(0); return 1 }
`)
 writeFileSync(join(dir, "base.json"), JSON.stringify({
  compilerOptions: { plugins: [{ name: "@effect/language-service", diagnosticSeverity: { effectSleepZeroToYieldNow: "warning" } }] },
  vibe: { severities: { EK3833: "error" } }
 }))
 writeFileSync(join(dir, ".oxlintrc.effect.json"), JSON.stringify({
  rules: { "effecttsgo/effect-sleep-zero-to-yield-now": "warn" }
 }))
 for (const args of [["-p", "tsconfig.json"], ["lint", "-p", "tsconfig.json"]]) {
  const result = spawnSync(native, [...args, "--pretty", "false"], { cwd: dir, encoding: "utf8" })
  assert.equal(result.error, undefined)
  assert.notEqual(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /error EK3006:/)
  assert.match(result.stdout, /warning EK3833:/)
  assert.doesNotMatch(result.stdout, /error EK3833:/)
 }
})

// Chapter 007 / invalid severity container retains error and emit consequences: docs/design/src/007-tooling.md#0df7b52faa5489ea
for (const mode of ["child", "later-base", "invalid-child", "independent", "container"]) {
 test("effective severity diagnostics: "+mode, {skip}, t => {
  const settings = mode === "later-base"
   ? {extends:["./base.json", "./later.json"]}
   : {extends:"./base.json", vibe:{severities:{EK4609:mode === "invalid-child" ? 42 : "off"}}}
  const dir = project(t, settings, source)
  const config = JSON.parse(readFileSync(join(dir, "tsconfig.json"), "utf8"))
  config.compilerOptions.noEmit = false
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(config))
  const base = mode === "container" ? {vibe:{severities:[]}}
   : {vibe:{severities:{EK4609:mode === "invalid-child" ? "error" : "bad", ...(mode === "independent" ? {EK0508:null} : {})}}}
  writeFileSync(join(dir, "base.json"), JSON.stringify(base))
  writeFileSync(join(dir, "later.json"), JSON.stringify({vibe:{severities:{EK4609:"off"}}}))
  const result = run(dir)
  const invalid = !["child", "later-base"].includes(mode)
  assert.equal(result.status === 0, !invalid, result.stdout+result.stderr)
  assert.equal(existsSync(join(dir, "dist/main.js")), !invalid, result.stdout)
  if (invalid) {
   assert.match(result.stdout, mode === "container" ? /error EK3007:/ : /error EK3006:/)
   assert.equal((result.stdout.match(/error EK300[67]:/g) || []).length, 1, result.stdout)
   assert.match(result.stdout, mode === "invalid-child" ? /tsconfig\.json/ : /base\.json/)
  } else {
   assert.doesNotMatch(result.stdout, /EK3006|EK4609/)
  }
 })
}
