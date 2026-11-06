import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { basename, dirname, join, matchesGlob } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"
import { makeConfig, wireTarget } from "../lib/steps.mjs"
import { wireDeveloperTools } from "../lib/tooling.mjs"
import { must } from "../lib/util.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check"), ts = require("typescript")
const typescript = dirname(require.resolve("typescript/package.json"))
const specification = readFileSync(new URL("../../../../docs/design/src/007-tooling.md", import.meta.url), "utf8")
const outputRule = "Declaration sidecars are emit outputs like `.d.ts`."
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-platform-declarations-lint.json", import.meta.url), "utf8"))
const ignored = (path, patterns) => patterns.some(p => matchesGlob(p.includes("/") ? path : basename(path), p))
const read = (root, path) => readFileSync(join(root, path), "utf8")
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), {recursive:true}); writeFileSync(join(root,file),text) }
async function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "module-declaration-lint-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [file,text] of Object.entries({
    "package.json": '{"name":"fixture","private":true,"type":"module"}',
    "tsconfig.json": '{"compilerOptions":{"noEmit":true},"include":["src"]}',
    ".oxlintrc.json": JSON.stringify({plugins:["unicorn"],ignorePatterns:["src/owned/**"],rules:{[corpus.rule]:"error"}}),
    ".prettierignore": "src/owned/**\n",
    "dprint.json": '{"includes":["**/*"],"excludes":["src/owned/**"]}',
    "eslint.config.mjs": 'export default [{ files: ["src/**/*.ts"], rules: { "no-debugger": "error" } }]\n',
    [corpus.sourceFile]: "module platform { export const value = 42; }\n",
    [corpus.generated]: corpus.declaration,
    [corpus.authored]: "export const value = 42;\n",
  })) put(root,file,text)
  mkdirSync(join(root,"node_modules"))
  symlinkSync(typescript,join(root,"node_modules/typescript"))
  await must("jj git init", {cwd:root})
  await must("jj config set --repo user.name test", {cwd:root})
  await must("jj config set --repo user.email test@localhost", {cwd:root})
  const config=makeConfig({target:root,packages:["."],test:"true",vibelangVersion:"0.0.11",install:"true"})
  await wireTarget(config,join(root,".logs"))
  return {root,config}
}
test("setup excludes generated module declarations from lint and formatting", async t => {
  assert.ok(specification.includes(outputRule))
  const {root,config}=await setup(t)
  const oxide=JSON.parse(read(root,".oxlintrc.json"))
  assert.equal(ignored(corpus.generated,oxide.ignorePatterns),true)
  assert.equal(ignored(corpus.authored,oxide.ignorePatterns),false)
  assert.equal(read(root,corpus.generated),corpus.declaration)
  const patterns=read(root,".prettierignore").trim().split("\n")
  assert.equal(ignored(corpus.generated,patterns),true)
  assert.equal(ignored(corpus.authored,patterns),false)
  const dprint=JSON.parse(read(root,"dprint.json"))
  assert.equal(ignored(corpus.generated,dprint.excludes),true)
  assert.ok(dprint.excludes.includes("src/owned/**"))
  const eslint=read(root,"eslint.config.mjs")
  assert.ok(eslint.includes("**/*.vibe.*.d.ts"))
  assert.ok(eslint.includes("**/*.d.vibex.ts"))
  const before=new Map([".oxlintrc.json",".prettierignore","dprint.json","eslint.config.mjs"].map(p=>[p,read(root,p)]))
  await wireTarget(config,join(root,".logs"))
  for(const [file,text] of before)assert.equal(read(root,file),text,file+" is not idempotent")
  const installed=fileURLToPath(new URL("../../../../packages/compiler/node_modules/.bin/oxlint",import.meta.url))
  const bin=process.env.VIBELANG_OXLINT_BINARY || (existsSync(installed) ? installed : undefined)
  await t.test("real Oxlint retains authored-source diagnostics",{skip:!bin},()=>{
  const lint=()=>spawnSync(bin,["--config",".oxlintrc.json","--disable-nested-config","src"],{cwd:root,encoding:"utf8"})
  const clean=lint();assert.equal(clean.status,0,clean.stdout+clean.stderr)
  put(root,corpus.authored,corpus.declaration)
  const authored=lint();assert.equal(authored.status,1,authored.stdout+authored.stderr)
  assert.match(authored.stdout+authored.stderr,/require-module-specifiers/)
  })
})
test("module declaration ignore neighbourhood keeps authored implementations selected", () => {
  const identifier=fc.array(fc.constantFrom(..."abcXYZ09_$"),{minLength:1,maxLength:16}).map(x=>"m"+x.join(""))
  fc.assert(fc.property(identifier,identifier,fc.constantFrom("vibe","vibex"),fc.constantFrom("src","src/nested","packages/lib/src"),
    (name,body,ext,dir)=>{
      const root=mkdtempSync(join(tmpdir(),"module-declaration-tools-"))
      try{
        put(root,"package.json",'{"name":"fixture","private":true}')
        put(root,"dprint.json",'{"includes":["**/*"],"excludes":["owned/**"]}')
        put(root,"eslint.config.mjs",'export default [{ files: ["**/*.ts"] }]')
        wireDeveloperTools({root,ts,specsFor:()=>({vibelang:"0.0.11"})})
        const patterns=JSON.parse(read(root,"dprint.json")).excludes
        const base=dir+"/"+name
        assert.equal(ignored(base+"."+ext+"."+body+".d.ts",patterns),true)
        for(const suffix of [".ts",".tsx",".vibe",".vibex",".platform.ts","."+ext+"."+body+".ts"])assert.equal(ignored(base+suffix,patterns),false,suffix)
        assert.ok(patterns.includes("owned/**"))
        const eslint=read(root,"eslint.config.mjs")
        const globals=[...eslint.matchAll(/ignores: \[([^\]]+)\]/g)].flatMap(m=>runInNewContext("["+m[1]+"]"))
        assert.equal(ignored(base+"."+ext+"."+body+".d.ts",globals),true)
        assert.equal(ignored(base+".platform.ts",globals),false)
      }finally{rmSync(root,{recursive:true,force:true})}
    }),{seed:440211,numRuns:100})
})

