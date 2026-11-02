import { writeProbeAwareCompiler } from "./fake-vibelang.mjs"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { pathAliases } from "../lib/codemod.mjs"
import { applyState, durableWrite, prepareState, saveState } from "../lib/codemod-state.mjs"
import { codemod, makeConfig, nextStep, paths, revert } from "../lib/steps.mjs"
import { must, readJson, writeJson } from "../lib/util.mjs"
import * as Jj from "../lib/jj.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = readJson(new URL("./corpus/foldkit-interrupted-codemod.json", import.meta.url))
const step = new URL("../step.mjs", import.meta.url).pathname
const ts = require.resolve("typescript/package.json").replace(/\/package.json$/, "")

async function fixture(files = corpus.files, batch = corpus.batch, manifest = { exports: { "./*": "./src/*.ts" } }) {
  const root = mkdtempSync(join(tmpdir(), "migrate-interrupted-"))
  const target = join(root, "repo"), run = join(root, "run")
  const put = (file, text) => { mkdirSync(join(target, file, ".."), { recursive: true }); writeFileSync(join(target, file), text) }
  for (const [file, text] of Object.entries(files)) put(file, text)
  put("package.json", JSON.stringify(manifest))
  put("tsconfig.json", '{"include":["src/**/*"]}')
  await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
  await Jj.commit(target, "original sources")
  mkdirSync(join(target, "node_modules/.bin"), { recursive: true })
  symlinkSync(ts, join(target, "node_modules/typescript"))
  const compiler = join(target, "node_modules/.bin/vibelang")
  writeProbeAwareCompiler(compiler, `#!/usr/bin/env node
const fs = require("node:fs")
if (!fs.existsSync("continue")) {
  fs.writeFileSync("started", String(process.pid))
  if (process.argv.includes("--fix")) setInterval(() => {}, 1000)
} else {
  console.log("vibelang --fix: 0 fixes in 0 files.")
}
`, { mode: 0o755 })
  writeJson(paths(run).config, makeConfig({ target, test: "true", vibelangVersion: "0.0.11" }))
  writeJson(paths(run).setup, {})
  writeJson(paths(run).plan, { batches: [{ files: batch }] })
  return { root, target, run, put, compiler }
}

test("foldkit-74: SIGKILL during compiler work resumes without renaming or losing originals", { timeout: 30000 }, async () => {
  const f = await fixture()
  let child, compilerPid
  try {
    child = spawn(process.execPath, [step, "codemod", "--run", f.run], { detached: true, stdio: "ignore" })
    const exit = new Promise(resolve => child.on("exit", resolve))
    for (let n = 0; !existsSync(join(f.target, "started")); n++) {
      if (n > 1000 || child.exitCode !== null) throw new Error("compiler did not start")
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    compilerPid = Number(readFileSync(join(f.target, "started"), "utf8"))
    process.kill(-child.pid, "SIGKILL")
    await exit
    assert.equal(existsSync(paths(f.run).codemod("01")), false)
    assert.deepEqual(nextStep(f.run), { step: "codemod", batch: "01" })
    f.put("src/meta.vibe", readFileSync(join(f.target, "src/meta.vibe"), "utf8") + "// checked hand repair\n")
    f.put("continue", "")
    const result = await codemod({ run: f.run })
    assert.equal(result.renames.length, 2)
    assert.equal(result.importEdits.length, 2)
    assert.match(readFileSync(join(f.target, "src/meta.vibe"), "utf8"), /checked hand repair/)
    assert.equal(result.fix.settled, true)
    // codemod.json records which earlier batch's modules the fix put back (none here).
    assert.deepEqual(result.fix.restored, [])
    const again = await codemod({ run: f.run })
    assert.deepEqual(again, result)
    // Original bytes are from the run, even if @- no longer contains TypeScript.
    await Jj.commit(f.target, "interrupted batch snapshot")
    await revert({ run: f.run, batch: "01", file: "src/value.vibe", reason: "regression dependency" })
    await revert({ run: f.run, batch: "01", file: "src/meta.vibe", reason: "regression witness" })
    assert.equal(readFileSync(join(f.target, "src/meta.ts"), "utf8"), corpus.files["src/meta.ts"])
    assert.equal(readFileSync(join(f.target, "test/meta.test.ts"), "utf8"), corpus.files["test/meta.test.ts"])
    assert.equal(readJson(join(f.target, "package.json")).exports["./meta"], undefined)
  } finally {
    if (child?.pid) { try { process.kill(-child.pid, "SIGKILL") } catch {} }
    if (compilerPid) { try { process.kill(compilerPid, "SIGKILL") } catch {} }
    rmSync(f.root, { recursive: true, force: true })
  }
})

test("foldkit-74: compiler failure leaves a replayable journal and per-file revert evidence", async () => {
  const f = await fixture()
  try {
    writeProbeAwareCompiler(f.compiler, "#!/bin/sh\nkill -TERM $$\n", { mode: 0o755 })
    await assert.rejects(codemod({ run: f.run }), /signal|terminated|exit|finish/i)
    writeProbeAwareCompiler(f.compiler, "#!/bin/sh\necho 'vibelang --fix: 0 fixes in 0 files.'\n", { mode: 0o755 })
    const result = await codemod({ run: f.run })
    assert.equal(result.importEdits.length, 2)
    assert.equal(readJson(paths(f.run).codemodState("01")).attempts.length, 2)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

// Contract from the README; the oracle is the original byte snapshot and the
// planned wiring, not a second invocation of the implementation under test.
test("foldkit-74: every interrupted prefix of rename/import/export writes replays once", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes("a stopped run resumes where it stopped"))
  fc.assert(fc.property(
    fc.array(fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/), { minLength: 1, maxLength: 6 }).map(xs => [...new Set(xs)]),
    fc.constantFrom("\n", "\r\n"), fc.constantFrom("'", '"'), fc.nat(30),
    (names, nl, q, cut) => {
      const root = mkdtempSync(join(tmpdir(), "migrate-replay-property-"))
      try {
        mkdirSync(join(root, "src"))
        const files = names.map(n => "src/" + n + ".ts")
        const originals = files.map((_, i) => "import { v as next } from " + q + "./" + names[(i + 1) % names.length] + ".js" + q + ";" + nl + "export const v = " + i + ";" + nl)
        files.forEach((file, i) => writeFileSync(join(root, file), originals[i]))
        writeFileSync(join(root, "package.json"), '{"exports":{"./*":"./src/*.ts"}}')
        writeFileSync(join(root, "consumer.ts"), "export * from " + q + "./src/" + names[0] + ".js" + q + nl)
        const state = prepareState(root, files, [...files, "consumer.ts"])
        saveState(join(root, "journal.json"), state)
        assert.ok(files.every(f => existsSync(join(root, f))), "preparation never mutates the target")
        const ops = [
          ...state.renames.map(r => () => renameSync(join(root, r.from), join(root, r.to))),
          ...state.writes.map(w => () => durableWrite(join(root, w.file), w.after, w.mode))
        ]
        ops.slice(0, cut % (ops.length + 1)).forEach(op => op())
        const resumed = readJson(join(root, "journal.json"))
        applyState(root, resumed)
        applyState(root, resumed)
        assert.equal(readFileSync(join(root, "consumer.ts"), "utf8"), "export * from " + q + "./src/" + names[0] + ".vibe" + q + nl)
        for (const [i, name] of names.entries()) {
          assert.equal(existsSync(join(root, files[i])), false)
          assert.equal(Buffer.from(resumed.originals[i].bytes, "base64").toString(), originals[i])
          assert.equal(readFileSync(join(root, "src/" + name + ".vibe"), "utf8"), originals[i].replace(".js", ".vibe"))
          assert.deepEqual(readJson(join(root, "package.json")).exports["./" + name], { types: "./src/" + name + ".d.vibe.ts", "vibelang-source": "./src/" + name + ".vibe", default: "./.vibelang/js/src/" + name + ".js" })
        }
      } finally { rmSync(root, { recursive: true, force: true }) }
    }
  ), { seed: 7433174, numRuns: 150 })
})

test("foldkit-74: replay refuses competing paths and changed contents without overwriting them", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-replay-conflict-"))
  try {
    writeFileSync(join(root, "a.ts"), "export const a = 1\n")
    const state = prepareState(root, ["a.ts"], ["a.ts"])
    writeFileSync(join(root, "a.vibe"), "// another file\n")
    assert.throws(() => applyState(root, state), /exactly one/)
    assert.equal(readFileSync(join(root, "a.vibe"), "utf8"), "// another file\n")
    rmSync(join(root, "a.vibe"))
    writeFileSync(join(root, "a.ts"), "// changed source\n")
    assert.throws(() => applyState(root, state), /changed since/)
    assert.equal(readFileSync(join(root, "a.ts"), "utf8"), "// changed source\n")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("foldkit-74: per-file revert works before the compiler completes", async () => {
  const f = await fixture()
  try {
    writeProbeAwareCompiler(f.compiler, "#!/bin/sh\nkill -TERM $$\n", { mode: 0o755 })
    await assert.rejects(codemod({ run: f.run }))
    assert.equal(existsSync(paths(f.run).codemod("01")), false)
    await revert({ run: f.run, batch: "01", file: "src/value.vibe", reason: "interrupted compiler" })
    assert.equal(readFileSync(join(f.target, "src/value.ts"), "utf8"), corpus.files["src/value.ts"])
    assert.equal(readFileSync(join(f.target, "src/meta.vibe"), "utf8"), corpus.files["src/meta.ts"].replace("./value.js", "./value.ts"))
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("foldkit-74: SIGKILL preserves planned platform siblings and the original unsplit source", { timeout: 30000 }, async () => {
  const sample = readJson(new URL("./corpus/foldkit-interrupted-platform-split.json", import.meta.url))
  const f = await fixture({ "src/main.ts": sample.source }, ["src/main.ts"], { private: true })
  let child
  try {
    child = spawn(process.execPath, [step, "codemod", "--run", f.run], { detached: true, stdio: "ignore" })
    const exit = new Promise(resolve => child.on("exit", resolve))
    for (let n = 0; !existsSync(join(f.target, "started")); n++) {
      if (n > 1000 || child.exitCode !== null) throw new Error("compiler did not start")
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    process.kill(-child.pid, "SIGKILL")
    await exit
    const journal = readJson(paths(f.run).codemodState("01"))
    assert.equal(Buffer.from(journal.originals[0].bytes, "base64").toString(), sample.source)
    assert.equal(journal.platform.splits.length, 1)
    assert.ok(existsSync(join(f.target, "src/main.platform.ts")))
    f.put("continue", "")
    const result = await codemod({ run: f.run })
    assert.equal(result.platform.splits.length, 1)
    await Jj.commit(f.target, "interrupted platform batch")
    await revert({ run: f.run, batch: "01", file: "src/main.vibe", reason: "restore unsplit source" })
    assert.equal(readFileSync(join(f.target, "src/main.ts"), "utf8"), sample.source)
    assert.equal(existsSync(join(f.target, "src/main.platform.ts")), false)
  } finally {
    if (child?.pid) { try { process.kill(-child.pid, "SIGKILL") } catch {} }
    rmSync(f.root, { recursive: true, force: true })
  }
})

test("platform siblings replay every partial write without replacing existing host code", () => {
  const parser = require("typescript")
  const sample = readJson(new URL("./corpus/foldkit-interrupted-platform-split.json", import.meta.url))
  fc.assert(fc.property(fc.integer({ min: 0, max: 5 }), fc.nat(20), fc.boolean(), (extra, cut, collision) => {
    const root = mkdtempSync(join(tmpdir(), "migrate-platform-replay-"))
    try {
      const source = sample.source + Array.from({ length: extra }, (_, i) => "export function extra" + i + "(): string { return sep }").join("\n")
      writeFileSync(join(root, "main.ts"), source)
      if (collision) writeFileSync(join(root, "main.platform.ts"), "existing companion")
      const state = prepareState(root, ["main.ts"], ["main.ts"], { ts: parser })
      assert.equal(readFileSync(join(root, "main.ts"), "utf8"), source)
      assert.equal(Buffer.from(state.originals[0].bytes, "base64").toString(), source)
      if (collision) {
        assert.equal(state.platform.splits.length, 0)
        assert.equal(state.platform.refused.length, 1)
      } else {
        assert.equal(existsSync(join(root, "main.platform.ts")), false)
        assert.equal(state.platform.splits.length, 1)
      }
      renameSync(join(root, "main.ts"), join(root, "main.vibe"))
      for (const write of state.writes.slice(0, cut % (state.writes.length + 1))) durableWrite(join(root, write.file), write.after, write.mode)
      applyState(root, state)
      applyState(root, state)
      assert.equal(readFileSync(join(root, "main.platform.ts"), "utf8"), collision ? "existing companion" : state.writes.find(w => w.file === "main.platform.ts").after)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { seed: 740104, numRuns: 120 })
})

test("durable preparation preserves tsconfig aliases through every interrupted write prefix", () => {
  const typed = require("typescript")
  const witness = readJson(new URL("./corpus/foldkit-interrupted-codemod-alias.json", import.meta.url))
  fc.assert(fc.property(fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/), fc.constantFrom("'", '"'), fc.nat(10), (name, q, cut) => {
    const root = mkdtempSync(join(tmpdir(), "migrate-replay-alias-"))
    try {
      mkdirSync(join(root, "src")); mkdirSync(join(root, "test"))
      const from = "src/" + name + ".ts", to = "src/" + name + ".vibe"
      const importer = "test/consumer.ts", before = "export * from " + q + witness.specifier.replace("value", name) + q + "\n"
      writeFileSync(join(root, "package.json"), '{"private":true}')
      writeJson(join(root, "tsconfig.json"), witness.tsconfig)
      writeFileSync(join(root, from), "export const value = 1\n")
      writeFileSync(join(root, importer), before)
      const state = prepareState(root, [from], [from, importer], { ts: typed, aliases: pathAliases(typed, root) })
      assert.equal(readFileSync(join(root, importer), "utf8"), before)
      const operations = [
        ...state.renames.map(r => () => renameSync(join(root, r.from), join(root, r.to))),
        ...state.writes.map(w => () => durableWrite(join(root, w.file), w.after, w.mode))
      ]
      operations.slice(0, cut % (operations.length + 1)).forEach(op => op())
      applyState(root, state); applyState(root, state)
      assert.ok(existsSync(join(root, to)))
      assert.equal(readFileSync(join(root, importer), "utf8"), before.replace(".js", ".vibe"))
      assert.equal(state.importEdits.find(e => e.file === importer).from, witness.specifier.replace("value", name))
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { seed: 7409759, numRuns: 120 })
})

test("foldkit-74: one-pass rename replays every durable prefix and bulk-reverts original bytes",async()=>{
  const { onePassStep } = await import("../lib/onepass.mjs")
  const { revertMany } = await import("../lib/steps.mjs")
  await fc.assert(fc.asyncProperty(fc.nat(20),async cut=>{
    const f=await fixture()
    try {
      const files=corpus.batch
      writeJson(paths(f.run).plan,{mode:"one-pass",batches:[{files}]})
      const state=prepareState(f.target,files,Object.keys(corpus.files))
      saveState(paths(f.run).codemodState("01"),state)
      const ops=[...state.renames.map(r=>()=>renameSync(join(f.target,r.from),join(f.target,r.to))),...state.writes.map(w=>()=>durableWrite(join(f.target,w.file),w.after,w.mode))]
      ops.slice(0,cut%(ops.length+1)).forEach(op=>op())
      const result=await onePassStep("rename",{run:f.run})
      assert.equal(result.renameComplete,true)
      assert.deepEqual(await onePassStep("rename",{run:f.run}),result)
      await revertMany({run:f.run,files:files.map(file=>({file:file.replace(/\\.ts$/,".vibe"),reason:"interruption control"}))})
      for(const file of files) assert.equal(readFileSync(join(f.target,file),"utf8"),corpus.files[file])
    }finally{rmSync(f.root,{recursive:true,force:true})}
  }),{numRuns:8,seed:740011})
})

// 8e01612ea773 on the journal: a literal Vite build input that names a renamed
// module is part of the prepared edits, so a codemod whose compiler dies
// resumes with it and revert takes it back.
test("a killed codemod's journal carries its Vite build entries for resume and revert", async () => {
  const vite = 'export default { build: { lib: { entry: "src/b.ts" } } };\n'
  const f = await fixture({
    "src/b.ts": "export const b = 1\n",
    "src/a.ts": 'import { b } from "./b.ts"\nexport const a = b\n',
    "vite.config.ts": vite
  }, ["src/b.ts"])
  try {
    writeProbeAwareCompiler(f.compiler, "#!/bin/sh\nif [ -f probe.vibe ]; then mkdir -p out; printf '%s\\n' 'export declare const f: () => Effect.Effect<number, never, never>;' > out/probe.d.ts; exit 0; fi\nkill -KILL $$\n", { mode: 0o755 })
    await assert.rejects(codemod({ run: f.run }), /did not finish/)
    assert.deepEqual(readJson(paths(f.run).codemodState("01")).buildEntries.edits, [{ file: "vite.config.ts", source: "src/b.ts", from: "src/b.ts", to: "src/b.vibe" }])
    assert.equal(readFileSync(join(f.target, "vite.config.ts"), "utf8"), vite.replace("src/b.ts", "src/b.vibe"))
    writeProbeAwareCompiler(f.compiler, "#!/bin/sh\nif [ -f probe.vibe ]; then mkdir -p out; printf '%s\\n' 'export declare const f: () => Effect.Effect<number, never, never>;' > out/probe.d.ts; exit 0; fi\necho 'vibelang --fix: 0 fixes in 0 files.'\n", { mode: 0o755 })
    const result = await codemod({ run: f.run })
    assert.equal(result.buildEntries.edits.length, 1)
    assert.equal(readFileSync(join(f.target, "vite.config.ts"), "utf8"), vite.replace("src/b.ts", "src/b.vibe"))
    await revert({ run: f.run, batch: "01", file: "src/b.vibe", reason: "build entry recovery" })
    assert.equal(readFileSync(join(f.target, "vite.config.ts"), "utf8"), vite)
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})
