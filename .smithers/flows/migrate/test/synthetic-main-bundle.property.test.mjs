import assert from "node:assert/strict"
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { rewriteSourceLiterals } from "../lib/source-paths.mjs"
import { prepareState } from "../lib/codemod-state.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-synthetic-main-bundle.json", import.meta.url), "utf8"))
const renames = [{ from:"src/main.ts",to:"src/main.vibe" }]
const rewrite = text => rewriteSourceLiterals(ts,text,corpus.file,renames,{inventory:["src/main.ts",corpus.file]})

test("t3code synthetic bundle paths retain their original TypeScript fixture", () => {
  const result = rewrite(corpus.source)
  assert.equal(result.text,corpus.source)
  assert.deepEqual(result.edits,[])
})

test("preparing an entry migration does not rewrite a fresh temporary bundle fixture", () => {
  const root = mkdtempSync(join(tmpdir(),"synthetic-main-bundle-"))
  try {
    mkdirSync(join(root,"src"));mkdirSync(join(root,"scripts"))
    writeFileSync(join(root,"package.json"),'{"type":"module","private":true}')
    writeFileSync(join(root,"src/main.ts"),"export const value = 1;\n")
    writeFileSync(join(root,corpus.file),corpus.source)
    const catalog = ["package.json","src/main.ts",corpus.file]
    const state = prepareState(root,["src/main.ts"],["src/main.ts",corpus.file],{
      ts,catalog,tracked:catalog,references:[corpus.file],pathSources:[corpus.file]
    })
    const changed = state.writes.find(row=>row.file===corpus.file)
    assert.ok(!changed || changed.after===corpus.source,JSON.stringify(changed))
    assert.equal(readFileSync(join(root,corpus.file),"utf8"),corpus.source)
  } finally { rmSync(root,{recursive:true,force:true}) }
})

test("real source imports still follow the migrated entry beside a synthetic fixture", () => {
  const source = 'import { value } from "../src/main.ts";\n'+corpus.source
  const result = rewrite(source)
  assert.equal(result.text,source.replace('"../src/main.ts"','"../src/main.vibe"'))
})

test("temporary fixture roots, import aliases and line endings preserve fixture bytes", () => {
  fc.assert(fc.property(fc.constantFrom("root","fixture","temporary"),fc.boolean(),fc.boolean(),(name,sync,crlf)=>{
    let source=corpus.source.replaceAll(/\broot\b/g,name)
    if(sync)source=source.replace('import { mkdtemp, writeFile } from "node:fs/promises";','import { mkdtempSync as fresh, writeFileSync as writeFile } from "node:fs";')
      .replace("await mkdtemp(","fresh(")
    if(crlf)source=source.replaceAll("\n","\r\n")
    assert.equal(rewrite(source).text,source)
  }),{seed:50584402,numRuns:50})
})

test("an entry escaping the temporary directory still names repository source", () => {
  const source=corpus.source.replace('entry: ["src/main.ts"]','entry: ["../src/main.ts"]')
  const result=rewrite(source)
  assert.ok(result.text.includes('entry: ["../src/main.vibe"]'),result.text)
  assert.ok(result.text.includes('join(root, "src/main.ts")'),result.text)
})

test("a same-named custom factory does not prove a fresh fixture directory", () => {
  const source=corpus.source.replace('"node:fs/promises"','"fixture-tools"')
  const result=rewrite(source)
  assert.ok(result.text.includes('"src/main.vibe"'),result.text)
})

test("namespace imports and immutable root aliases preserve temporary inputs", () => {
  const source=corpus.source.replace('import { mkdtemp, writeFile } from "node:fs/promises";','import * as FS from "node:fs/promises";')
    .replace("await mkdtemp(","await FS.mkdtemp(").replace("await writeFile(","await FS.writeFile(")
    .replace('await FS.writeFile','const fixtureRoot = root;\nawait FS.writeFile').replace("join(root,","join(fixtureRoot,").replace("cwd: root","cwd: fixtureRoot")
  assert.equal(rewrite(source).text,source)
})

test("verification distinguishes fixture inputs from real stale source paths", async () => {
  const {checkConvertedPaths} = await import("../lib/converted-paths.mjs")
  const check = source => checkConvertedPaths({ts,tracked:["package.json","src/main.vibe",corpus.file],
    read:file=>file==="package.json"?'{"type":"module"}':file===corpus.file?source:"export const value = 1;\n"})
  assert.equal(check(corpus.source).ok,true,JSON.stringify(check(corpus.source)))
  const escaped=corpus.source.replace('entry: ["src/main.ts"]','entry: ["../src/main.ts"]')
  assert.equal(check(escaped).ok,false)
  const real='await build({ entry: ["src/main.ts"] });\n'+corpus.source
  assert.equal(check(real).ok,false)
})

test("an unawaited directory promise does not prove a fixture path root", () => {
  const source=corpus.source.replace("await mkdtemp(","mkdtemp(")
  assert.ok(rewrite(source).text.includes('"src/main.vibe"'))
})
