import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
const root = fileURLToPath(new URL("../../../../", import.meta.url))
const ts = createRequire(import.meta.url)(path.join(root, "docs/tools/node_modules/typescript"))
assert.equal(ts.version, "5.9.3")
const temp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "vibex-roots-"))
let cells = 0
try {
 for (const source of [".ts", ".tsx"]) {
  for (const artifacts of [[".d.ts"], [".js"], [".jsx"], [".d.ts", ".js", ".jsx"]]) {
   for (const allowJs of [false, true]) {
    for (const jsx of ["preserve", "react"]) {
     for (const explicit of [false, true]) {
      for (const reverse of [false, true]) {
       const dir = path.join(temp, String(cells++)); fs.mkdirSync(dir)
       const names = [source, ...artifacts].map(ext => "Panel" + ext)
       for (const name of names) fs.writeFileSync(path.join(dir, name), "export const value=1;")
       const config = { compilerOptions: { allowJs, jsx } }
       if (explicit) config.files = names
       else config.include = (reverse ? [source, ...artifacts] : [...artifacts, source]).map(ext => "**/*" + ext)
       const result = ts.parseJsonConfigFileContent(config, ts.sys, dir)
       assert.deepEqual(result.errors, [])
       const got = result.fileNames.map(name => path.basename(name)).sort()
       const want = (explicit ? names : ["Panel" + source]).sort()
       assert.deepEqual(got, want, JSON.stringify({source, artifacts, allowJs, jsx, explicit, reverse}))
      }
     }
    }
   }
  }
 }
 for (const source of [".ts",".tsx"]) for (const artifact of [".d.ts",".js",".jsx"]) {
  for (const allowJs of [false,true]) for (const jsx of ["preserve","react"]) for (const literalSource of [false,true]) {
   const dir=path.join(temp,String(cells++));fs.mkdirSync(dir)
   const sourceName="Panel"+source, artifactName="Panel"+artifact
   for (const name of [sourceName,artifactName]) fs.writeFileSync(path.join(dir,name),"export const value=1;")
   const config={compilerOptions:{allowJs,jsx},files:[literalSource?sourceName:artifactName],include:["**/*"+(literalSource?artifact:source)]}
   const parsed=ts.parseJsonConfigFileContent(config,ts.sys,dir)
   assert.deepEqual(parsed.errors,[])
   const want=(literalSource?[sourceName]:[sourceName,artifactName]).sort()
   assert.deepEqual(parsed.fileNames.map(name=>path.basename(name)).sort(),want,JSON.stringify(config))
  }
 }
 console.log("TypeScript " + ts.version + ": " + cells + " native wildcard/explicit-input controls PASS")
 let cli = 0
 for (const source of [".ts", ".tsx"]) {
  for (const allowJs of [false, true]) {
   for (const explicit of [false, true]) {
    const dir = path.join(temp, "cli-" + cli++); fs.mkdirSync(dir)
    const names = [source, ".d.ts", ".js", ".jsx"].map(ext => "Panel" + ext)
    for (const name of names) fs.writeFileSync(path.join(dir, name), "export const value=1;")
    const config = { compilerOptions: { allowJs, jsx: "preserve", types: [] } }
    if (explicit) config.files = names
    else config.include = ["**/*"]
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(config))
    const ran = spawnSync(process.execPath, [path.join(root, "docs/tools/node_modules/typescript/lib/tsc.js"), "--showConfig", "-p", dir], {encoding:"utf8"})
    assert.equal(ran.status, 0, ran.stdout + ran.stderr)
    const got = JSON.parse(ran.stdout).files.map(name => path.basename(name)).sort()
    assert.deepEqual(got, (explicit ? names : ["Panel" + source]).sort())
   }
  }
 }
 for (const source of [".ts",".tsx"]) for (const allowJs of [false,true]) for (const literalSource of [false,true]) {
  const dir=path.join(temp,"cli-"+cli++);fs.mkdirSync(dir)
  const sourceName="Panel"+source,artifacts=["Panel.d.ts","Panel.js","Panel.jsx"]
  for (const name of [sourceName,...artifacts]) fs.writeFileSync(path.join(dir,name),"export const value=1;")
  const config={compilerOptions:{allowJs,jsx:"preserve",types:[]},files:literalSource?[sourceName]:artifacts,include:["**/*"]}
  fs.writeFileSync(path.join(dir,"tsconfig.json"),JSON.stringify(config))
  const ran=spawnSync(process.execPath,[path.join(root,"docs/tools/node_modules/typescript/lib/tsc.js"),"--showConfig","-p",dir],{encoding:"utf8"})
  assert.equal(ran.status,0,ran.stdout+ran.stderr)
  const want=(literalSource?[sourceName]:[sourceName,...artifacts]).sort()
  assert.deepEqual(JSON.parse(ran.stdout).files.map(name=>path.basename(name)).sort(),want)
 }
 console.log("tsc " + ts.version + " --showConfig: " + cli + " native CLI controls PASS")

} finally { fs.rmSync(temp, {recursive:true, force:true}) }
