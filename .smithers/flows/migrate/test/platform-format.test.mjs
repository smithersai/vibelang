import { writeProbeAwareCompiler } from "./fake-vibelang.mjs"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { codemod, makeConfig, paths, revert } from "../lib/steps.mjs"
import { writeJson } from "../lib/util.mjs"
const require = createRequire(new URL("../../../../packages/compiler/package.json", import.meta.url))
const runtimeRequire = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = runtimeRequire("typescript"), fc = require("fast-check"), prettier = require("prettier")
const prettierBin = require.resolve("prettier/bin/prettier.cjs")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-platform-split-format.json", import.meta.url), "utf8"))

async function fixture({ file = corpus.file, source = corpus.source, formatter = "prettier", fail = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "alchemy-platform-format-"))
  const target = join(root, "repo"), run = join(root, "run")
  for (const dir of ["node_modules/.bin", dirname(file)]) mkdirSync(join(target, dir), { recursive: true })
  symlinkSync(dirname(runtimeRequire.resolve("typescript/package.json")), join(target, "node_modules/typescript"), "dir")
  writeJson(join(target, "package.json"), { type: "module", private: true, scripts: { "format:check": formatter === "dprint" ? "dprint check ." : formatter + " --check ." } })
  writeFileSync(join(target, ".gitignore"), "node_modules/\n")
  writeJson(join(target, "tsconfig.json"), { compilerOptions: { noEmit: true, allowImportingTsExtensions: true }, include: ["src/**/*"] })
  writeFileSync(join(target, file), source)
  writeFileSync(join(target, "unrelated.ts"), "export const  untouched=1\n")
  writeProbeAwareCompiler(join(target, "node_modules/.bin/vibelang"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
  const calls = join(root, "format-args.json")
  const script = fail
    ? '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(' + JSON.stringify(calls) + ', JSON.stringify(process.argv.slice(2))); console.error("formatter rejected platform sibling"); process.exit(17);\n'
    : '#!/usr/bin/env node\nconst {spawnSync}=require("node:child_process"),fs=require("node:fs"); fs.writeFileSync(' + JSON.stringify(calls) + ', JSON.stringify(process.argv.slice(2))); process.exit(spawnSync(process.execPath,[' + JSON.stringify(prettierBin) + ', "--write", ...process.argv.slice(2).filter(x=>x.endsWith(".ts"))],{stdio:"inherit"}).status??1);\n'
  writeFileSync(join(target, "node_modules/.bin", formatter), script, { mode: 0o755 })
  const init = spawnSync("jj", ["git", "init", target], { encoding: "utf8" })
  assert.equal(init.status, 0, init.stderr)
  const p = paths(run)
  writeJson(p.config, makeConfig({ target, test: "true", vibelangVersion: "0.0.11" }))
  writeJson(p.setup, {})
  writeJson(p.plan, { batches: [{ files: [file] }] })
  return { root, target, run, calls, p, platform: file.replace(/\.ts$/, ".platform.ts"), cleanup: () => rmSync(root, { recursive: true, force: true }) }
}
test("alchemy: generated platform code satisfies the target formatter before record runs", async () => {
  const f = await fixture()
  try {
    const result = await codemod({ run: f.run, batch: "01" })
    assert.equal(result.platform.splits.length, 1)
    const output = readFileSync(join(f.target, f.platform), "utf8")
    assert.equal(await prettier.check(output, { filepath: f.platform }), true, "the written hatch must already satisfy the repository's formatter")
    assert.deepEqual(result.platform.formatted.files, [f.platform])
    assert.equal(result.platform.formatted.code, 0)
    assert.equal(readFileSync(join(f.target, "unrelated.ts"), "utf8"), "export const  untouched=1\n")
    assert.deepEqual(await codemod({ run: f.run, batch: "01" }), result, "a resumed codemod returns the persisted formatting receipt")
  } finally { f.cleanup() }
})
test("property: generated siblings retain names and valid TypeScript across formatter argv shapes and filename quoting", async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom("prettier", "oxfmt", "dprint"),
    fc.constantFrom("plain", "with space", "with'apostrophe", "dollar$sign"), fc.boolean(), fc.integer({ min: 0, max: 7 }),
    async (formatter, base, crlf, n) => {
      const name = "createRouteId" + n
      const file = "src/" + base + n + ".ts"
      const source = corpus.source.replaceAll("createRouteId", name).replaceAll("\n", crlf ? "\r\n" : "\n")
      const f = await fixture({ file, source, formatter })
      try {
        const result = await codemod({ run: f.run, batch: "01" })
        assert.equal(result.platform.splits.length, 1)
        assert.deepEqual(result.platform.formatted.files, [f.platform])
        assert.equal(result.platform.formatted.code, 0)
        const args = JSON.parse(readFileSync(f.calls))
        assert.equal(args.at(-1), f.platform, "one exact filename reaches the formatter despite shell metacharacters")
        const output = readFileSync(join(f.target, f.platform), "utf8")
        assert.equal(await prettier.check(output, { filepath: f.platform }), true)
        const parsed = ts.createSourceFile(f.platform, output, ts.ScriptTarget.Latest, true)
        assert.deepEqual(parsed.parseDiagnostics, [])
        assert.ok(parsed.statements.some(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => d.name.text === name)), output)
      } finally { f.cleanup() }
    }), { seed: 480048, numRuns: 60 })
})
test("formatting failures remain visible with their files, exit and log", async () => {
  const f = await fixture({ fail: true })
  try {
    const result = await codemod({ run: f.run, batch: "01" })
    assert.equal(result.platform.formatted.code, 17)
    assert.deepEqual(result.platform.formatted.files, [f.platform])
    assert.match(readFileSync(join(f.p.run, result.platform.formatted.log), "utf8"), /formatter rejected platform sibling/)
  } finally { f.cleanup() }
})

test("no split or no configured formatter produces an explicit no-op receipt", async () => {
  for (const hasSplit of [false, true]) {
    const f = await fixture(hasSplit ? {} : { source: "export const value = 1;\n" })
    try {
      if (hasSplit) writeJson(join(f.target, "package.json"), { type: "module", private: true })
      const result = await codemod({ run: f.run, batch: "01" })
      assert.equal(result.platform.splits.length, Number(hasSplit))
      assert.deepEqual(result.platform.formatted.files, [])
      assert.equal(result.platform.formatted.code, 0)
      assert.equal(result.platform.formatted.log, null)
      assert.equal(existsSync(f.calls), false)
    } finally { f.cleanup() }
  }
})

test("alchemy: a TypeScript import widened by the rename satisfies the formatter before verify", async () => {
  const c=JSON.parse(readFileSync(new URL("./corpus/alchemy-rewritten-import-format.json",import.meta.url)))
  const f=await fixture({file:c.file,source:c.source})
  try{
    assert.equal(await prettier.check(c.text,{filepath:c.importer}),true)
    writeFileSync(join(f.target,c.importer),c.text)
    const result=await codemod({run:f.run,batch:"01"})
    const written=readFileSync(join(f.target,c.importer),"utf8")
    assert.ok(written.includes(".vibe"))
    assert.equal(await prettier.check(written,{filepath:c.importer}),true,"the changed importer must already satisfy format:check")
    assert.ok(result.formatted.files.includes(c.importer))
    const restored = await revert({run:f.run,batch:"01",file:c.file.replace(/\.ts$/,".vibe"),reason:"test restores the TypeScript boundary"})
    const afterRevert = readFileSync(join(f.target,c.importer),"utf8")
    assert.equal(await prettier.check(afterRevert,{filepath:c.importer}),true)
    assert.equal(afterRevert,c.text)
    assert.ok(restored.formatted.files.includes(c.importer))
    assert.equal(readFileSync(join(f.target,"unrelated.ts"),"utf8"),"export const  untouched=1\n")
  }finally{f.cleanup()}
})

test("property: widened importers and their reversions retain target style with quoted paths and varied names", async () => {
  await fc.assert(fc.asyncProperty(fc.integer({min:0,max:6}),fc.constantFrom(""," ","'","$"),async (padding,suffix)=>{
    const first="firstValue"+"x".repeat(padding)
    const stem="VeryLongModule"+"x".repeat(17-padding-suffix.length)+suffix
    const file="src/"+stem+".ts",importer="src/Consumer.ts"
    const source="export const "+first+" = 1;\nexport const secondValue = 2;\n"
    const text="import { "+first+", secondValue } from "+JSON.stringify("./"+stem+".ts")+";\nexport const both = ["+first+", secondValue];\n"
    assert.equal(await prettier.check(text,{filepath:importer}),true)
    const f=await fixture({file,source})
    try{
      writeFileSync(join(f.target,importer),text)
      const changed=await codemod({run:f.run,batch:"01"})
      assert.ok(changed.formatted.files.includes(importer))
      assert.equal(await prettier.check(readFileSync(join(f.target,importer),"utf8"),{filepath:importer}),true)
      await revert({run:f.run,batch:"01",file:file.replace(/\.ts$/,".vibe"),reason:"property restores original source"})
      assert.equal(readFileSync(join(f.target,importer),"utf8"),text)
    }finally{f.cleanup()}
  }),{seed:480049,numRuns:30})
})

test("formatter targets exclude tests and fixtures even when mechanical import edits name them", async () => {
  const c=JSON.parse(readFileSync(new URL("./corpus/alchemy-rewritten-import-format.json",import.meta.url)))
  const f=await fixture({file:c.file,source:c.source})
  try{
    const file="src/Consumer.test.ts"
    writeFileSync(join(f.target,file),c.text)
    const result=await codemod({run:f.run,batch:"01"})
    assert.ok(!result.formatted.files.includes(file))
    const output=readFileSync(join(f.target,file),"utf8")
    assert.ok(output===c.text || output===c.text.replace('.ts"','.vibe"'))
  }finally{f.cleanup()}
})
