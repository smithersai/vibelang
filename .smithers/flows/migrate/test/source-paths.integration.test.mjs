import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { applyState, prepareState, saveState } from "../lib/codemod-state.mjs"
const { codemod, importers, makeConfig, paths, revert } = await import(process.env.VIBE_FLOW_STEPS ?? new URL("../lib/steps.mjs", import.meta.url))
import * as Jj from "../lib/jj.mjs"
import { must, readJson, writeJson } from "../lib/util.mjs"

const require=createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const tsdir=require.resolve("typescript/package.json").replace(/\/package.json$/, "")
const corpus = readJson(new URL("./corpus/foldkit-test-source-paths.json", import.meta.url))
const originals = { ...corpus.files, "test/themeColor.test.ts": corpus.identityTest, "src/main.ts": corpus.files["src/main.ts"] + "\nconst modulePaths = import.meta.glob('src/value.ts')\n" }
for (const split of [false, true]) for (const legacy of [false, true]) for (const order of [["main", "value"], ["value", "main"]]) test("foldkit-67 durable flow and literal revert order: " + order + " legacy=" + legacy + " split=" + split, async () => {
  const root=mkdtempSync(join(tmpdir(),"foldkit-source-wiring-"))
  const target=join(root,"repo"), run=join(root,"run")
  try {
    for (const [file,text] of Object.entries(originals)) {
      mkdirSync(join(target,file,".."),{recursive:true});writeFileSync(join(target,file),text)
    }
    writeFileSync(join(target,"unrelated.txt"),'const source = "src/main.ts"')
    mkdirSync(join(target,"assets"),{recursive:true})
    writeFileSync(join(target,"assets/diagram.pdf"),'%PDF-1.4\n"src/main.ts"\n')
    writeFileSync(join(target,"package.json"),'{"private":true}')
    writeFileSync(join(target,"tsconfig.json"),'{"include":["src/**/*"]}')
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost",{cwd:target})
    await Jj.commit(target,"original")
    mkdirSync(join(target,"node_modules/.bin"),{recursive:true})
    symlinkSync(tsdir,join(target,"node_modules/typescript"))
    writeFileSync(join(target,"node_modules/.bin/vibelang"),"#!/bin/sh\necho 'vibelang --fix: 0 fixes in 0 files.'\n",{mode:0o755})
    writeJson(paths(run).config,makeConfig({target,test:"true",vibelangVersion:"0.0.11"}))
    writeJson(paths(run).inventory,{files:Object.keys(originals).map(path=>({path}))})
    const batches=split ? [["src/value.ts"],["src/main.ts"]] : [corpus.batch]
    writeJson(paths(run).plan,{batches:batches.map(files=>({files}))})
    const allEdits=[]
    for (const [index,files] of batches.entries()) {
      const batch=String(index+1).padStart(2,"0")
      if (legacy) {
        // Pre-literal journals did not contain the later one-pass reference pass.
        const state=prepareState(target,files,await importers(target),{referenceFiles:[]})
        delete state.referenceVersion; delete state.referencePending
        delete state.referenceEdits; delete state.referenceWarnings
        applyState(target,state); state.phase="fixing"
        saveState(paths(run).codemodState(batch),state)
      }
      const result=await codemod({run,batch})
      assert.equal(result.referenceScan.files,Object.keys(originals).length)
      assert.ok(result.referenceScan.durationMs >= 0)
      assert.ok(result.referenceScan.patterns >= 0)
      allEdits.push(...result.referenceEdits)
      await Jj.commit(target,"fixture batch "+batch)
    }
    assert.match(readFileSync(join(target,"test/themeColor.test.ts"),"utf8"),/existsSync\('src\/main.vibe'/)
    assert.match(readFileSync(join(target,"test/themeColor.test.ts"),"utf8"),/toEqual\('src\/main.vibe'/)
    assert.equal(readFileSync(join(target,"assets/diagram.pdf"),"utf8"),'%PDF-1.4\n"src/main.ts"\n')
    assert.equal(readFileSync(join(target,"unrelated.txt"),"utf8"),'const source = "src/main.ts"')
    assert.equal(allEdits.length,4)
    assert.ok(allEdits.some(edit => edit.selectorKind === "source-glob"))
    for (const name of order) await revert({run,batch:String(batches.length).padStart(2,"0"),file:"src/"+name+".vibe",reason:"literal wiring regression"})
    assert.equal(readFileSync(join(target,"src/main.ts"),"utf8"),originals["src/main.ts"])
    assert.equal(readFileSync(join(target,"test/themeColor.test.ts"),"utf8"),originals["test/themeColor.test.ts"])
    assert.equal(existsSync(join(target,"src/main.vibe")),false)
  } finally {rmSync(root,{recursive:true,force:true})}
})

test("source-text assertion corpus stays TypeScript under detail 272",()=>{
 const root=mkdtempSync(join(tmpdir(),"foldkit-source-text-"))
 try{
  for(const[file,text]of Object.entries(corpus.files)){
   mkdirSync(join(root,file,".."),{recursive:true});writeFileSync(join(root,file),text)
  }
  assert.throws(()=>prepareState(root,corpus.batch,Object.keys(corpus.files)),/source text test requires .ts/)
  for(const file of corpus.batch)assert.equal(readFileSync(join(root,file),"utf8"),corpus.files[file])
 }finally{rmSync(root,{recursive:true,force:true})}
})
