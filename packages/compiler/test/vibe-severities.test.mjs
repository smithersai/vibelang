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
export effect function pause() { try Effect.sleep(0); return 1 }
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
  const legacy={trustedPackages:["example-package"]}
  const settings={vibe:{severities:{EK4609:"warning"}},...(inherited?{extends:"./base.json"}:{vibelang:legacy})}
  const dir=project(t,settings,source)
  if(inherited) writeFileSync(join(dir,"base.json"),JSON.stringify({vibelang:legacy}))
  const result=run(dir,"--showConfig")
  assert.equal(result.status,0,result.stdout+result.stderr)
  const shown=JSON.parse(result.stdout)
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

const legacyCommentShapes = {
 wrapper: '{ /* KEEP_WRAPPER */ "diagnostics":{"EK4830":"off"}}',
 tail: '{"diagnostics":{"EK4830":"off" /* KEEP_TAIL */}}',
 empty: '{"diagnostics":{/* KEEP_EMPTY */}}',
 superseded: '{"diagnostics":{/* KEEP_SUPERSEDED */ "EK4831":"error"}}',
 trailing: '{"diagnostics":{"EK4830":"off", // KEEP_TRAILING\n}}',
 retained: '{"trustedPackages":["keep"], /* KEEP_PROPERTY */ "diagnostics":{"EK4830":"off" /* KEEP_MAP_TAIL */} // KEEP_WRAPPER_TAIL\n}',
}
for (const [shape, legacy] of Object.entries(legacyCommentShapes)) {
 for (const nested of [false, true]) {
  for (const inherited of [false, true]) {
   test(`--fix retains legacy comments ${shape}, nested=${nested}, extends=${inherited}`, { skip }, t => {
    const dir = project(t, inherited ? { extends: "./base.json" } : {}, "export const value=1")
    const file = join(dir, inherited ? "base.json" : "tsconfig.json")
    const original = inherited ? {} : JSON.parse(readFileSync(file, "utf8"))
    // Keep the valid project options when testing the compilerOptions path.
    const options = JSON.stringify(original.compilerOptions || {}).slice(0, -1)
    delete original.compilerOptions
    const prefix = JSON.stringify(original).slice(0, -1)
    const text = prefix + (prefix.length > 1 ? "," : "") +
     (nested ? `"compilerOptions":${options}${options.length > 1 ? "," : ""}"vibelang":${legacy}}` :
      `"compilerOptions":${options}},"vibelang":${legacy}`) +
     ',"vibe":{"effectModules":false,"severities":{"EK4831":"off"}}}'
    writeFileSync(file, text)
    const shownBefore = run(dir, "--showConfig")
    assert.equal(shownBefore.status, 0, shownBefore.stdout + shownBefore.stderr)
    const first = run(dir, "--fix")
    assert.equal(first.status, 0, first.stdout + first.stderr)
    const fixed = readFileSync(file, "utf8")
    for (const marker of text.match(/\/\* KEEP_[A-Z_]+ \*\/|\/\/ KEEP_[A-Z_]+/g)) {
     assert.equal(fixed.split(marker).length, text.split(marker).length, fixed)
    }
    assert.doesNotMatch(fixed, /"diagnostics"/)
    const shown = run(dir, "--showConfig")
    assert.equal(shown.status, 0, shown.stdout + shown.stderr)
    const modern = JSON.parse(shown.stdout).vibe
    assert.equal(modern.effectModules, false)
    assert.equal(modern.severities.EK4831, "off")
    if (shape !== "empty" && shape !== "superseded") assert.equal(modern.severities.EK4830, "off")
    const second = run(dir, "--fix")
    assert.equal(second.status, 0, second.stdout + second.stderr)
    assert.equal(readFileSync(file, "utf8"), fixed)
    assert.equal(readFileSync(join(dir, "main.vibe"), "utf8"), "export const value=1")
   })
  }
 }
}

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
