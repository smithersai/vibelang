import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import vm from "node:vm"
import { test } from "node:test"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { codemod, importers, makeConfig, paths, revert } from "../lib/steps.mjs"
import { applyState, prepareState, saveState } from "../lib/codemod-state.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, writeJson } from "../lib/util.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-build-config-entries.json", import.meta.url)))
const entries = text => {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(text, {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, {exports})
  return Object.values(exports.default.entry)
}
for (const legacy of ["fresh", "legacy", "v1"]) test("Alchemy entries outside src follow a batch rename and restore: legacy=" + legacy, async () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(corpus.quote))
  const root = mkdtempSync(join(tmpdir(), "alchemy-build-entries-")), target = join(root,"repo"), run = join(root,"run")
  const put = (file,text) => { mkdirSync(dirname(join(target,file)),{recursive:true});writeFileSync(join(target,file),text) }
  try {
    put("package.json", JSON.stringify({private:true,workspaces:["packages/*"]}))
    put(".gitignore", "node_modules/\n")
    put("tsconfig.json", JSON.stringify({include:["packages/*/src/**/*.ts","packages/*/src/**/*.vibe"]}))
    const originals = Object.fromEntries(corpus.modules.map(file => [file, "export const value: number = 42\n"]))
    originals[corpus.modules[0]] += "export const peer = " + JSON.stringify(posix.relative(dirname(corpus.modules[0]),corpus.modules[1])) + "\n"
    for (const [file,text] of Object.entries(originals)) put(file,text)
    for (const [file,text] of Object.entries(corpus.configs)) {
      put(file,text);put(join(dirname(file),"package.json"),JSON.stringify({name:dirname(file).split("/").pop()}))
    }
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost",{cwd:target})
    await Jj.commit(target,"original")
    mkdirSync(join(target,"node_modules/.bin"),{recursive:true})
    symlinkSync(dirname(require.resolve("typescript/package.json")),join(target,"node_modules/typescript"))
    put("node_modules/.bin/vibelang","#!/bin/sh\necho 'vibelang --fix: 0 fixes in 0 files.'\n")
    await must("chmod +x node_modules/.bin/vibelang",{cwd:target})
    const p = paths(run)
    writeJson(p.config, makeConfig({target,test:"true",vibelangVersion:"0.0.11"}))
    // Exactly the source-only inventory used by the Alchemy drive.
    writeJson(p.inventory,{files:corpus.modules.map(path=>({path}))})
    writeJson(p.plan,{batches:[{files:corpus.modules}]})
    if (legacy !== "fresh") {
      const options = legacy === "legacy" ? {referenceFiles:[]} :
        {ts,referenceFiles:[],references:corpus.modules,catalog:await Jj.trackedFiles(target)}
      const state=prepareState(target,corpus.modules,await importers(target),options)
      if (legacy === "legacy") delete state.referenceVersion
      applyState(target,state);state.phase="fixing";saveState(p.codemodState("01"),state)
    }
    const result=await codemod({run,batch:"01"})
    assert.equal(result.referenceScan.toolConfigFiles,2)
    assert.equal(result.referenceScan.files,4)
    for (const file of Object.keys(corpus.configs)) {
      const text=readFileSync(join(target,file),"utf8")
      for (const entry of entries(text)) {
        assert.ok(existsSync(join(target,dirname(file),entry)),"UNRESOLVED_ENTRY: "+entry)
        assert.ok(entry.endsWith(".vibe"),file)
      }
      assert.ok(result.referenceEdits.some(edit=>edit.file===file && edit.kind==="source-reference"),file)
    }
    assert.ok(result.referenceEdits.some(edit=>edit.file===corpus.modules[0].replace(/\.ts$/,".vibe") &&
      edit.module===corpus.modules[1].replace(/\.ts$/,".vibe")),"earlier source edit remains revertible")
    assert.ok(readFileSync(join(target,Object.keys(corpus.configs)[0]),"utf8").startsWith("// src/vite/plugin.ts"))
    await Jj.commit(target,"migrated batch")
    for (const file of corpus.modules) await revert({run,batch:"01",file:file.replace(/\.ts$/,".vibe"),reason:"entry path regression"})
    for (const [file,text] of Object.entries(originals)) assert.equal(readFileSync(join(target,file),"utf8"),text,file)
    for (const [file,text] of Object.entries(corpus.configs)) assert.equal(readFileSync(join(target,file),"utf8"),text,file)
  } finally { rmSync(root,{recursive:true,force:true}) }
})
