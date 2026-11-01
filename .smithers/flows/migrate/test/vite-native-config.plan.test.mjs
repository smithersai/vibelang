import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { makeConfig, paths, plan } from "../lib/steps.mjs"
import { readJson, writeJson } from "../lib/util.mjs"

// drive-foldkit-web 23:03Z (foldkit-78): the planner refused packages/website/vite.config.ts
// although setup had wired the website's vite scripts with the foldkit-41 loader.
const corpus = readJson(new URL("./corpus/foldkit-plan-vite-config.json", import.meta.url))
const record = (path, extra = {}) => ({ path, package: "packages/website", test: false, lines: 8, tokens: 40, effect: "values", effectImports: ["effect"], imports: [], dependents: [], testedBy: [], coverage: null, ...extra })

function setupRun(t, setup) {
  const root = mkdtempSync(join(tmpdir(), "migrate-plan-vite-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const target = join(root, "repo"), run = join(root, "run")
  mkdirSync(join(target, "packages/website/src"), { recursive: true })
  writeJson(join(target, "package.json"), { private: true, scripts: corpus.rootScripts })
  writeJson(join(target, "packages/website/package.json"), { name: "website", private: true, scripts: corpus.scripts })
  writeFileSync(join(target, corpus.path), 'import { Effect } from "effect"\nexport default {}\n')
  writeJson(paths(run).config, makeConfig({ target, packages: ["packages/website"], test: "true", vibelangVersion: "0.0.11" }))
  writeJson(paths(run).setup, setup)
  writeJson(paths(run).inventory, { packages: ["packages/website"], summary: { effectValueFiles: 2 }, files: [record(corpus.path), record("packages/website/src/leaf.ts")] })
  const answer = join(root, "answer.json")
  writeJson(answer, { version: 1, batches: [{ files: [corpus.path], reason: "the config imports migrated helpers" }] })
  return { run, answer }
}

test("foldkit-78: the planner accepts a Vite config whose scripts setup wired with the native loader", async t => {
  const { run, answer } = setupRun(t, { nativeViteConfigs: [corpus.path] })
  const result = await plan({ run, accept: answer })
  assert.equal(result.accepted, true)
  assert.deepEqual(result.plan.batches[0].files, [corpus.path])
  assert.ok(readJson(paths(run).planDraft).batches.some(batch => batch.files.includes(corpus.path)), "the draft offers the wired config")
  assert.match(readFileSync(paths(run).planPrompt, "utf8"), /except a Vite config whose scripts setup wired with the native config loader \(`packages\/website\/vite\.config\.ts`\)/)
})

test("foldkit-78: without that wiring the planner still keeps a tool's config in TypeScript", async t => {
  const { run, answer } = setupRun(t, { nativeViteConfigs: [] })
  await assert.rejects(plan({ run, accept: answer }), new RegExp(corpus.refusal))
  assert.ok(!readJson(paths(run).planDraft).batches.some(batch => batch.files.includes(corpus.path)))
  assert.doesNotMatch(readFileSync(paths(run).planPrompt, "utf8"), /except a Vite config/)
})

test("whole-scope Vite configs require the same native loader receipt",async()=>{
 const {planScope}=await import("../lib/onepass.mjs")
 const {createRequire}=await import("node:module")
 const fc=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))("fast-check")
 fc.assert(fc.property(fc.boolean(),fc.constantFrom(".ts",".mts"),(wired,ext)=>{
  const root=mkdtempSync(join(tmpdir(),"migrate-native-scope-"))
  try{
   const file=corpus.path.replace(/\\.ts$/,ext)
   mkdirSync(join(root,file,".."),{recursive:true})
   writeFileSync(join(root,file),"export default {}")
   writeFileSync(join(root,"leaf.ts"),"export const value=1")
   const result=planScope(root,[file,"leaf.ts"],{nativeConfigs:wired?[file]:[]})
   assert.equal(result.batches[0].files.includes(file),wired)
   assert.equal(result.deferred.some(d=>d.file===file),!wired)
   assert.ok(result.batches[0].files.includes("leaf.ts"))
  }finally{rmSync(root,{recursive:true,force:true})}
 }),{numRuns:40,seed:780011})
})
