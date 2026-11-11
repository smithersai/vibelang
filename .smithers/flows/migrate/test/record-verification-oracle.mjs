import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { recordDeclarationSurface } from "../lib/declarations.mjs"
import { makeConfig, paths, record, report, verify } from "../lib/steps.mjs"
import { countTokens } from "../lib/tokens.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, readJson, slug, writeJson } from "../lib/util.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))
const corpus = readJson(new URL("./corpus/foldkit-record-formatted-declarations.json",import.meta.url))

export async function fixture(drift, name, action, pattern=corpus) {
  const root=mkdtempSync(join(tmpdir(),"foldkit-record-certificate-")), target=join(root,"repo"),run=join(root,"run")
  try {
    mkdirSync(join(target,"node_modules/.bin"),{recursive:true})
    symlinkSync(require.resolve("typescript/package.json").replace(/\/package.json$/,""),join(target,"node_modules/typescript"))
    writeJson(join(target,"package.json"),{name:"foldkit-fixture",version:"1.0.0",files:["main.ts","main.vibe"],types:"./main.d.ts"})
    writeJson(join(target,"tsconfig.json"),{compilerOptions:{rootDir:"."},include:["*.vibe"]})
    writeFileSync(join(target,".gitignore"),"node_modules/\n")
    const source=pattern.before.replaceAll("createLazy",name),formatted=pattern.formatted.replaceAll("createLazy",name)
    const before=pattern.beforeDeclaration.replaceAll("createLazy",name),after=(drift?pattern.formattedDeclaration:pattern.beforeDeclaration).replaceAll("createLazy",name)
    writeFileSync(join(target,"main.ts"),source)
    if (pattern.guardTest) {
      mkdirSync(join(target,"test"),{recursive:true})
      writeFileSync(join(target,pattern.guardTest.file),pattern.guardTest.before)
    }
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost",{cwd:target})
    await Jj.commit(target,"original")
    renameSync(join(target,"main.ts"),join(target,"main.vibe"))
    writeFileSync(join(target,"node_modules/.bin/vibelang-format"),[
      "#!/usr/bin/env node",'const fs=require("node:fs");',
      'fs.writeFileSync("main.vibe",'+JSON.stringify(formatted)+');',
      ...(pattern.guardTest ? ['fs.writeFileSync('+JSON.stringify(pattern.guardTest.file)+','+JSON.stringify(pattern.guardTest.after)+');'] : [])
    ].join("\n"),{mode:0o755})
    writeFileSync(join(target,"node_modules/.bin/vibelang"),[
      "#!/usr/bin/env node",'const fs=require("node:fs"),p=require("node:path");',
      'const i=process.argv.indexOf("--outDir"); if(i>=0){const out=process.argv[i+1];fs.mkdirSync(out,{recursive:true});fs.writeFileSync(p.join(out,"main.d.ts"),fs.readFileSync("main.vibe","utf8")==='+JSON.stringify(source)+'?'+JSON.stringify(before)+':'+JSON.stringify(after)+');}'
    ].join("\n"),{mode:0o755})
    const p=paths(run)
    writeJson(p.config,makeConfig({target,test:"true",vibelangVersion:"0.0.11"}))
    writeJson(p.plan,{batches:[{files:["main.ts"]}]})
    writeJson(p.inventory,{files:[{path:"main.ts",tokens:999}]})
    writeJson(join(p.baseline,"tests.json"),{code:0,tests:{},total:0,passed:0,failed:[],skipped:0})
    writeJson(join(p.baseline,"compile-"+slug(".")+".json"),[])

    writeJson(join(p.baseline, "upstream-packs.json"), { packages: { ".": { files: ["main.ts", "package.json"] } } })

    // This fixture isolates emit/format certification with a known matching stock baseline.
    writeJson(join(p.baseline, "declaration-oracle.json"), { ".": { compiler: "fixture-stock", files: [], missing: [], extra: [], changed: [] } })
    const baseline=join(p.baseline,"dts",slug("."))
    mkdirSync(baseline,{recursive:true})
    writeFileSync(join(baseline,"main.d.ts"),before)
    recordDeclarationSurface(require("typescript"),baseline,target,[{tsconfig:"tsconfig.json",prefix:"."}])
    return await action({root,target,run,p,source,formatted})
  } finally {rmSync(root,{recursive:true,force:true})}
}


export async function check(drift, name, pattern) {
await fixture(drift,name,async({run,p,target,formatted})=>{
  const checked=await verify({run,batch:"01"})
  assert.equal(checked.ok,true,JSON.stringify(checked))
  assert.equal(checked.checks.declarations,true)
  const recorded=await record({run,batch:"01"})
  assert.ok(recorded.commit)
  assert.equal(readFileSync(join(target,"main.vibe"),"utf8"),formatted)
  const counts=await countTokens([join(target,"main.vibe")])
  assert.equal(recorded.tokens.after,counts[join(target,"main.vibe")])
  assert.equal(readJson(p.verify("01")).ok,true)
},pattern)
}
