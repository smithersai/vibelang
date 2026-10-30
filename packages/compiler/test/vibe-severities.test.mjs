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
test("--fix migrates inherited legacy settings and remains idempotent",{skip},t=>{
 const dir=project(t,{extends:"./base.json"},source)
 writeFileSync(join(dir,"base.json"),`{ // preserve this comment\n"vibelang":{"diagnostics":{"EK4609":"off"}}}`)
 const before=run(dir)
 assert.match(before.stdout,/warning EK3009:/)
 const first=run(dir,"--fix")
 assert.equal(first.status,0,first.stdout+first.stderr)
 const fixed=readFileSync(join(dir,"base.json"),"utf8")
 assert.match(fixed,/preserve this comment/)
 assert.match(fixed,/"severities"/)
 assert.doesNotMatch(fixed,/"diagnostics"/)
 const second=run(dir,"--fix")
 assert.equal(second.status,0,second.stdout+second.stderr)
 assert.equal(readFileSync(join(dir,"base.json"),"utf8"),fixed)
 assert.doesNotMatch(second.stdout,/EK3009/)
})

for (const severity of ["error","warning","suggestion","off"]) {
 test(`imported EK3833 ${severity} overrides the language-service plugin`,{skip},t=>{
  const dir=project(t,{vibe:{severities:{EK3833:severity}}},`import { Effect } from "effect"
export function pause() { Effect.sleep(0); return 1 }
`)
  const result=run(dir,"--noEmit")
  assert.equal(result.status===0,severity!=="error",result.stdout+result.stderr)
  if(severity==="warning" || severity==="error") assert.match(result.stdout,new RegExp(`${severity} EK3833: effectSleepZeroToYieldNow: Consider `))
  else assert.doesNotMatch(result.stdout,/EK3833/)
  const lint=spawnSync(native,["lint","-p","tsconfig.json"],{cwd:dir,encoding:"utf8"})
  assert.equal(lint.status===0,severity!=="error",lint.stdout+lint.stderr)
  if(severity==="warning" || severity==="error") assert.match(lint.stdout,new RegExp(`${severity} EK3833:`))
  else assert.doesNotMatch(lint.stdout,/EK3833/)
 })
}

for (const severity of ["error","warning","suggestion","off"]) {
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
 test(`modern severities preserve ${inherited ? "inherited" : "local"} legacy options`,{skip},t=>{
  const legacy={tracing:"all",trustedPackages:["example-package"]}
  const settings={vibe:{severities:{EK4609:"warning"}},...(inherited?{extends:"./base.json"}:{vibelang:legacy})}
  const dir=project(t,settings,source)
  if(inherited) writeFileSync(join(dir,"base.json"),JSON.stringify({vibelang:legacy}))
  const result=run(dir,"--showConfig")
  assert.equal(result.status,0,result.stdout+result.stderr)
  const shown=JSON.parse(result.stdout)
  assert.equal(shown.compilerOptions.vibelang?.tracing,"all")
  assert.deepEqual(shown.compilerOptions.vibelang?.trustedPackages,["example-package"])
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
