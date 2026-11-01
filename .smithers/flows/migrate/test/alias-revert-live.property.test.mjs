import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
import { pathAliases, renameBatch, rewriteImports } from "../lib/codemod.mjs"
import { makeConfig, paths, revert, revertMany } from "../lib/steps.mjs"
import * as Jj from "../lib/jj.mjs"
import {prepareState,applyState,saveState} from "../lib/codemod-state.mjs"
import { must, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const compiler = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-live-alias-revert.json", import.meta.url), "utf8"))
async function fixture({ kind = ".vibe", prefix = "@/", name = "a", flag = true, compile = false, bulk = false, journal = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "opencode-revert-alias-")), target = join(root, "repo"), run = join(root, "run")
  try {
    const importer = "src/use" + kind, module = "src/" + name + ".ts"
    const originalSuffix = /\.[cm]?jsx?$/.test(kind) ? ".ts" : ".js"
    const original = 'import { x } from "' + prefix + name + originalSuffix + '"; ' + (bulk ? 'import { extra } from "' + prefix + 'extra' + originalSuffix + '"; ' : '') + 'export const value = x\n'
    const files = { "package.json": corpus.files["package.json"], ".gitignore": corpus.files[".gitignore"], [module]: "export const x = 42\n", [importer]: original,
      "tsconfig.json": JSON.stringify({ compilerOptions: { module: "Preserve", moduleResolution: "Bundler", target: "ES2022", allowArbitraryExtensions: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: flag, paths: { [prefix + "*"]: ["./src/*"] } }, include: ["src/**/*"] }) }
    if (bulk) files["src/extra.ts"] = "export const extra = 1\n"
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(target, file)), { recursive: true }); writeFileSync(join(target, file), text)
    }
    mkdirSync(join(target, "node_modules"), { recursive: true })
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    const check = () => {
      const result = spawnSync(compiler, ["-p", "tsconfig.json", "--noEmit", "--pretty", "false", "--singleThreaded"], { cwd: target, encoding: "utf8" })
      assert.equal(result.status, 0, result.stdout + result.stderr)
    }
    if (compile) check()
    await Jj.commit(target, "native alias baseline")
    writeJson(paths(run).config, makeConfig({ target, test: "true", vibelangVersion: "0.0.11" }))
    const modules = bulk ? [module, "src/extra.ts"] : [module]
    writeJson(paths(run).plan, { batches: [{ files: modules }] })
    const aliases = pathAliases(ts, target)
    let renames,importEdits
    if (journal) {
      const state=prepareState(target,modules,[importer,...modules],{aliases})
      saveState(paths(run).codemodState("01"),state)
      applyState(target,state)
      renames=state.renames;importEdits=state.importEdits
    } else {
      renames=renameBatch(target,modules)
      importEdits=rewriteImports(target,[importer,...renames.map(r=>r.to)],renames.map(r=>r.to),aliases)
    }
    assert.equal(importEdits.length, modules.length)
    writeJson(paths(run).codemod("01"), { importEdits })
    const results = bulk
      ? await revertMany({ run, batch: "01", files: renames.map(r => ({ file: r.to, reason: "opencode bulk alias witness" })) })
      : [await revert({ run, batch: "01", file: renames[0].to, reason: "opencode alias witness" })]
    assert.equal(results.length, modules.length)
    const result = results[0]
    if (compile) check()
    assert.equal(readFileSync(join(target, importer), "utf8"), original)
    assert.ok(result.importEdits.some(edit => edit.file === importer && edit.to === prefix + name + originalSuffix))
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("opencode alias revert restores a live VibeLang importer's original accepted spelling", async () => fixture())
test("recorded alias restoration preserves original names over native and migrated consumers", async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom(".ts", ".vibe", ".js", ".mjs", ".cjs", ".jsx"), fc.constantFrom("@/", "~/", "#app/"), fc.constantFrom("a", "nested/helper"), fc.boolean(), fc.boolean(), async (kind, prefix, name, flag, journal) => fixture({ kind, prefix, name, flag, journal })), { seed: 580058, numRuns: 100 })
})
test("native compiler accepts the VibeLang alias both before migration and after revert", { skip: !compiler && "set VIBELANG_BINARY" }, async () => fixture({ compile: true }))

test("alias revert follows the documented original-name contract", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes('Revert restores recorded imports of native and previously existing VibeLang consumers, preserving the original alias and suffix.'))
})

test("bulk revert restores two recorded aliases in the same existing VibeLang consumer", async () => fixture({ bulk: true }))

const ioRule = "Existing tools work."
function injectedIO({kind=".vibe",target=".ts",nested=false,quote='"',preserve=true,sourceLiteral=false}={}) {
  const dir=nested?"src/deep":"src",file=dir+"/consumer"+kind,dep=dir+"/dep"+target
  const suffix=sourceLiteral?(target===".vibe"?".ts":target):target===".mts"?".mjs":target===".cts"?".cjs":".js"
  const first="./dep"+suffix,second=nested?"../deep/dep"+suffix:"../src/dep"+suffix
  const original="import {value as kept} from "+quote+first+quote+"; import {value as changed} from "+quote+second+quote+";\n"
  const texts=new Map([[file,original],[dep,"export const value=42\n"]]),reads=[],writes=[]
  const edits=rewriteImports("/virtual-opencode",[file,dep],[dep],undefined,{
    preserve:preserve?[{file,to:first}]:[],
    read:name=>{reads.push(name);assert.ok(texts.has(name));return texts.get(name)},
    write:(name,text)=>{writes.push(name);texts.set(name,text)}
  })
  const rewrite=(kind===".vibe"||target===".vibe")&&(!/\.[cm]?jsx?$/.test(kind)||sourceLiteral)
  const next=literal=>rewrite?literal.slice(0,-suffix.length)+target:literal
  const expected=original.replace(first,preserve?first:next(first)).replace(second,next(second))
  assert.equal(texts.get(file),expected)
  assert.deepEqual(reads,[file,dep])
  assert.equal(writes.length,expected===original?0:1)
  assert.equal(edits.length,(preserve||next(first)===first?0:1)+(next(second)===second?0:1))
}
test("opencode alias revert retains preserve with injected read and write callbacks",()=>injectedIO())
test("injected alias I/O oracle quotes chapter7",()=>assert.ok(readFileSync(new URL("../../../../docs/design/src/007-tooling.md",import.meta.url),"utf8").includes(ioRule)))
test("property: recorded names coexist with transactional import I/O",()=>checkProperty(fc,{
  name:"alias-revert-injected-io",rule:ioRule,command:"node --test .smithers/flows/migrate/test/alias-revert-live.property.test.mjs",regressions:new URL("./corpus/",import.meta.url),numRuns:160,
  arbitrary:fc.record({kind:fc.constantFrom(".vibe",".ts",".mts",".js",".mjs",".cjs",".jsx"),target:fc.constantFrom(".ts",".mts",".cts",".vibe"),nested:fc.boolean(),quote:fc.constantFrom('"',"'"),preserve:fc.boolean(),sourceLiteral:fc.boolean()}),check:injectedIO
}))

test("journal-backed alias revert classifies an existing Vibe consumer without a source revision",()=>fixture({journal:true}))
test("journal-backed bulk revert retains two original aliases",()=>fixture({journal:true,bulk:true}))

test("JavaScript importer aliases roundtrip with journal and baseline receipts",async()=>{for(const journal of [false,true]) await fixture({kind:".mjs",journal,bulk:true})})
