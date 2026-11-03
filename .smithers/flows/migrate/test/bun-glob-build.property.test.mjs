import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { tmpdir } from "node:os"
import { wireBunBuilds } from "../lib/wire.mjs"
import { addBunBuildGlobs } from "../lib/bun-globs.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const require = createRequire(join(repo, "packages/runtime/package.json"))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-bun-glob-build-entries.json", import.meta.url)))
const scratch = tmpdir()

function fixture(source, names, file = "script/build.ts") {
  const root = mkdtempSync(join(scratch, "opencode-bun-glob-build-"))
  const put = (file, text) => { mkdirSync(dirname(join(root,file)), { recursive: true }); writeFileSync(join(root,file),text) }
  put("package.json", '{"name":"entry-fixture","type":"module"}')
  put(file, source)
  put("tsconfig.json",JSON.stringify({compilerOptions:{strict:true,target:"ES2022",module:"Preserve",moduleResolution:"Bundler",types:[]},include:["src"]}))
  for (const name of names) put("src/"+name+".ts", "export const value = 1\n")
  put("src/keep.ts","export const keep = 2\n")
  put("src/types.d.ts","export declare const erased: number\n")
  mkdirSync(join(root,"node_modules"),{recursive:true})
  symlinkSync(join(repo,"packages/unplugin"),join(root,"node_modules/vibelang-unplugin"),"dir")
  symlinkSync(join(repo,"packages/compiler"),join(root,"node_modules/vibelang"),"dir")
  symlinkSync(join(repo,"packages/runtime"),join(root,"node_modules/vibelang-runtime"),"dir")
  symlinkSync(join(repo,"packages/runtime/node_modules/effect"),join(root,"node_modules/effect"),"dir")
  const selected = () => {
    const run = spawnSync("bun", ["-e", 'const m = await import('+JSON.stringify("./"+file)+'); console.log(JSON.stringify(m.entries.slice().sort()))'], { cwd:root,encoding:"utf8",timeout:30000 })
    assert.ifError(run.error)
    assert.equal(run.status,0,run.stderr)
    return JSON.parse(run.stdout.trim())
  }
  return { root, put, selected, remove:()=>rmSync(root,{recursive:true,force:true}) }
}

test("opencode: setup preserves Bun.Glob build inputs after source renames", () => {
  const f = fixture(corpus.source,corpus.names)
  try {
    assert.deepEqual(f.selected(),["keep.ts",...corpus.names.map(name=>name+".ts")].sort(),"native source control")
    for(const name of corpus.names) {
      renameSync(join(f.root,"src/"+name+".ts"),join(f.root,"src/"+name+".vibe"))
      f.put("src/"+name+".d.vibe.ts","export declare const value: 1\n")
    }
    const wired = wireBunBuilds({root:f.root,packages:[{dir:"."}],ts,specsFor:()=>({vibelang:"0.0.11","vibelang-unplugin":"0.0.11"})})
    assert.deepEqual(wired.warnings,[])
    assert.deepEqual(f.selected(),["keep.ts",...corpus.names.map(name=>name+".vibe")].sort(),
      "every converted build entry survives and generated declarations are not entries")
    assert.deepEqual(wireBunBuilds({root:f.root,packages:[{dir:"."}],ts,specsFor:()=>({vibelang:"0.0.11","vibelang-unplugin":"0.0.11"})}).changed,[])
  } finally { f.remove() }
})

function variant(style, pattern = "**/*.ts") {
  const construct = style === "imported" ? "new Glob(" : "new Bun.Glob("
  const glob = construct + JSON.stringify(pattern) + ")"
  const scanner = style.includes("async") || style === "promise" ? "scan" : "scanSync"
  const scan = (style === "inline" ? glob : "glob") + "."+scanner+'({cwd:"src"})'
  const prefix = (style === "imported" ? 'import { Glob } from "bun";\n' : "") +
    (style === "inline" ? "" : "const glob = "+glob+";\n")
  const collect = style === "promise" ?
    'export const entries = await Array.fromAsync('+scan+').then(files => files.filter(file => !file.endsWith(".d.ts")));\n' :
    style.startsWith("loop") ?
    'const entries = []; for '+(scanner === "scan" ? "await " : "")+'(const file of '+scan+') { if (file.endsWith(".d.ts")) continue; entries.push(file); }\nexport { entries };\n' :
    'export const entries = '+(scanner === "scan" ? '(await Array.fromAsync('+scan+'))' : '[...'+scan+']')+'.filter(file => !file.endsWith(".d.ts"));\n'
  return prefix + collect +
    'export const unrelated = new Bun.Glob("docs/**/*.ts");\n' +
    'export async function build() { return Bun.build({entrypoints:entries.map(file=>"src/"+file),outdir:"dist"}) }\n'
}
test("property: Bun build selectors preserve native/migrated names across lazy scan forms", () => {
  fc.assert(fc.property(
    fc.constantFrom("inline","bound","async","promise","loop","loop-async","imported"),
    fc.constantFrom("script/build.ts","script/build.mjs"),
    fc.integer({min:1,max:4}),fc.integer({min:0,max:2}),
    fc.constantFrom("Entry","Runtime.error","café","with space"),
    (style,file,count,depth,stem) => {
      const names = Array.from({length:count},(_,i)=>"nested/".repeat(depth)+stem+i)
      const f = fixture(variant(style),names,file)
      try {
        const native = f.selected()
        for (const name of names) {
          renameSync(join(f.root,"src/"+name+".ts"),join(f.root,"src/"+name+".vibe"))
          f.put("src/"+name+".d.vibe.ts","export declare const value: 1\n")
        }
        const result = wireBunBuilds({root:f.root,packages:[{dir:"."}],ts,specsFor:()=>({vibelang:"0.0.11","vibelang-unplugin":"0.0.11"})})
        assert.deepEqual(result.warnings,[])
        assert.deepEqual(f.selected().map(path=>path.replace(/\.vibe$/,".ts")).sort(),native)
        const changed = readFileSync(join(f.root,file),"utf8")
        assert.ok(changed.includes('new Bun.Glob("docs/**/*.ts")'),"unrelated selector stays authored")
        assert.deepEqual(wireBunBuilds({root:f.root,packages:[{dir:"."}],ts,specsFor:()=>({vibelang:"0.0.11","vibelang-unplugin":"0.0.11"})}).changed,[])
      } finally { f.remove() }
    }),{seed:820182,numRuns:120})
})

test("Bun.build output preserves every native entry after the package becomes mixed", () => {
  const f = fixture(corpus.source,corpus.names)
  const build = () => {
    rmSync(join(f.root,"dist"),{recursive:true,force:true})
    const result = spawnSync("bun",["-e",'const m = await import("./script/build.ts"); const output = await m.build(); if(!output.success) throw new AggregateError(output.logs);'],{cwd:f.root,encoding:"utf8",timeout:120000,env:{...process.env,VIBELANG_BINARY:process.env.VIBELANG_BINARY || join(repo,"packages/compiler/native/vibelang")}})
    assert.ifError(result.error)
    assert.equal(result.status,0,result.stderr)
    return readdirSync(join(f.root,"dist"),{recursive:true}).filter(file=>file.endsWith(".js")).sort()
  }
  try {
    const expected = ["keep.js",...corpus.names.map(name=>name+".js")].sort()
    assert.deepEqual(build(),expected,"native package build control")
    for(const name of corpus.names) {
      renameSync(join(f.root,"src/"+name+".ts"),join(f.root,"src/"+name+".vibe"))
      f.put("src/"+name+".d.vibe.ts","export declare const value: 1\n")
    }
    const result = wireBunBuilds({root:f.root,packages:[{dir:"."}],ts,specsFor:()=>({vibelang:"0.0.11","vibelang-unplugin":"0.0.11"})})
    assert.deepEqual(result.warnings,[])
    assert.deepEqual(build(),expected,"expected modules equal dist, without declarations masquerading as entries")
  } finally { f.remove() }
})

test("Bun producer scope: shadowed globals, type imports and overwritten options stay authored", () => {
  const body = 'const entries = [...new Bun.Glob("**/*.ts").scanSync()]; Bun.build({entrypoints:entries})'
  for(const source of [
    "function local(Bun) {"+body+"}",
    'import type * as Bun from "bun"; '+body,
    'const Bun = custom; '+body,
    'const entries = [...new Bun.Glob("**/*.ts").scanSync()]; Bun.build({entrypoints:entries,...settings})',
    'const entries = [...new Bun.Glob("**/*.ts").scanSync()]; Bun.build({entrypoints:entries,entrypoints:other})'
  ]) assert.equal(addBunBuildGlobs(source,ts).text,source)
  const ignored = 'Bun.build({entrypoints: Array.fromAsync(new Bun.Glob("**/*.ts").scan()).then(files => [])})'
  assert.equal(addBunBuildGlobs(ignored,ts).text,ignored,"a then callback that ignores files is not an entry producer")
})
test("Bun producer scope: computed patterns are reported without a guessed selector", () => {
  const source = 'const entries = [...new Bun.Glob(pattern).scanSync()]; Bun.build({entrypoints:entries})'
  const result = addBunBuildGlobs(source,ts)
  assert.equal(result.text,source)
  assert.equal(result.warnings.length,1)
  assert.match(result.warnings[0],/line 1: computed Bun.Glob/)
})
test("setup refreshes already wired build scripts and avoids authored helper names", () => {
  const source = 'import vibelang from "vibelang-unplugin/bun";\nconst __vibelangBuildGlob = 1, __vibelangBuildGlob2 = 2;\n' +
    corpus.source.replace('outdir: "dist"','outdir: "dist", plugins: [vibelang()]')
  const f = fixture(source,corpus.names)
  try {
    for(const name of corpus.names) {
      renameSync(join(f.root,"src/"+name+".ts"),join(f.root,"src/"+name+".vibe"))
      f.put("src/"+name+".d.vibe.ts","export declare const value: 1\n")
    }
    const result = wireBunBuilds({root:f.root,packages:[{dir:"."}],ts,specsFor:()=>({vibelang:"0.0.11","vibelang-unplugin":"0.0.11"})})
    assert.deepEqual(result.warnings,[])
    assert.ok(result.changed.includes("script/build.ts"))
    const after = readFileSync(join(f.root,"script/build.ts"),"utf8")
    assert.match(after,/class __vibelangBuildGlob3 extends Bun.Glob/)
    assert.deepEqual(f.selected(),["keep.ts",...corpus.names.map(name=>name+".vibe")].sort())
  } finally { f.remove() }
})

test("a Bun shebang stays first when a script has no imports", () => {
  const result = addBunBuildGlobs("#!/usr/bin/env bun\n"+corpus.source,ts)
  assert.ok(result.text.startsWith("#!/usr/bin/env bun\n"))
  assert.match(result.text,/class __vibelangBuildGlob/)
})

test("declaration-only and unrelated extension globs keep their original contract", () => {
  for (const pattern of ["**/*.d.ts","**/*.d.mts","docs/**/*.json","**/*.vibe"]) {
    const source = 'const entries = [...new Bun.Glob('+JSON.stringify(pattern)+').scanSync()]; Bun.build({entrypoints:entries})'
    assert.equal(addBunBuildGlobs(source,ts).text,source)
  }
})
