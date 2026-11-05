import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import vm from "node:vm"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
import { applyState, prepareState, saveState } from "../lib/codemod-state.mjs"
import { codemod, makeConfig, paths, revert } from "../lib/steps.mjs"
import { onePassStep } from "../lib/onepass.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, writeJson } from "../lib/util.mjs"
import { writeProbeAwareCompiler } from "./fake-vibelang.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-computed-build-entry.json", import.meta.url), "utf8"))
const script = "scripts/generate-device-stream.mts"

function fixture(t, text = corpus.script, module = corpus.module) {
  const root = mkdtempSync(join(tmpdir(), "migrate-computed-entry-")), target = join(root, "repo"), run = join(root, "run")
  const put = (file, text) => { mkdirSync(dirname(join(target, file)), {recursive:true}); writeFileSync(join(target, file), text) }
  put("package.json", '{"name":"computed-build","private":true,"type":"module"}\n')
  put(".gitignore", "node_modules/\n")
  put("tsconfig.json", '{"compilerOptions":{"noEmit":true},"include":["src"]}\n')
  mkdirSync(join(target, "node_modules"), {recursive:true})
  symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
  put(module, corpus.source)
  put(script, text)
  const tracked = ["package.json", ".gitignore", "tsconfig.json", module, script]
  const options = {ts, tracked, catalog:tracked, references:[script]}
  const clean = () => rmSync(root, {recursive:true, force:true})
  if (t) t.after(clean)
  return {target, run, put, module, tracked, options, clean}
}

async function runBuildEntry(f) {
  const exports = {}
  const build = options => {
    const entry = options.build.lib.entry
    assert.ok(existsSync(join(f.target, entry)), "the computed build input must remain reachable")
    return {entry, source:readFileSync(join(f.target, entry), "utf8"), formats:options.build.lib.formats}
  }
  vm.runInNewContext(ts.transpileModule(readFileSync(join(f.target, script), "utf8"), {
    compilerOptions:{module:ts.ModuleKind.CommonJS}
  }).outputText, {exports, require:module => module === "vite-plus" ? {build} : require(module)})
  return JSON.parse(JSON.stringify(await exports.generate("devices", "Device")))
}

test("t3code computed build entries refuse before renaming their source", t => {
  const f = fixture(t)
  assert.throws(() => prepareState(f.target, [f.module], [f.module], f.options),
    /scripts\/generate-device-stream\.mts:6:.*computed build entry.*device-stream\.browser\.ts/)
  assert.equal(readFileSync(join(f.target, f.module), "utf8"), corpus.source)
  assert.equal(readFileSync(join(f.target, script), "utf8"), corpus.script)
  assert.equal(existsSync(join(f.target, f.module.replace(/\.ts$/, ".vibe"))), false)
})

for (const mode of ["batch", "prepared", "one-pass", "one-pass-prepared", "one-pass-applied", "applied"]) test("computed entry refusal survives " + mode + " recovery and preserves the original command", async t => {
  const f = fixture(t)
  const before = await runBuildEntry(f)
  mkdirSync(join(f.target, "node_modules/.bin"), {recursive:true})
  writeProbeAwareCompiler(join(f.target, "node_modules/.bin/vibelang"), '#!/bin/sh\necho "vibelang --fix: 0 fixes in 0 files."\n', {mode:0o755})
  await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", {cwd:f.target})
  await Jj.commit(f.target, "original")
  const p = paths(f.run)
  writeJson(p.config, makeConfig({target:f.target, test:"true", vibelangVersion:"0.0.11"}))
  writeJson(p.inventory, {files:[{path:f.module}]})
  writeJson(p.plan, { ...(mode.startsWith("one-pass") ? {mode:"one-pass"} : {}), batches:[{files:[f.module]}] })
  if (mode.endsWith("prepared") || mode.endsWith("applied")) {
    // Model a journal created before computed entry preflight existed.
    const state = prepareState(f.target, [f.module], [f.module], {ts, tracked:[]})
    if (mode.endsWith("applied")) { applyState(f.target, state); state.phase = "fixing" }
    saveState(p.codemodState("01"), state)
  }
  const invoke = () => mode.startsWith("one-pass") ? onePassStep("rename", {run:f.run}) : codemod({run:f.run, batch:"01"})
  await assert.rejects(invoke, /computed build entry/)
  await assert.rejects(invoke, /computed build entry/)
  if (mode.endsWith("applied")) await revert({run:f.run, batch:"01", file:f.module.replace(/\.ts$/, ".vibe"), reason:"computed entry remains TypeScript"})
  assert.equal(readFileSync(join(f.target, f.module), "utf8"), corpus.source)
  assert.equal(readFileSync(join(f.target, script), "utf8"), corpus.script)
  assert.equal(existsSync(join(f.target, f.module.replace(/\.ts$/, ".vibe"))), false)
  assert.deepEqual(await runBuildEntry(f), before)
})

test("property: computed entry neighbours refuse only a possibly selected source", async () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(corpus.quote))
  await checkProperty(fc, {
    name:"computed-build-entry-reachability", rule:corpus.quote,
    command:"node --test .smithers/flows/migrate/test/computed-build-entrypoints.test.mjs",
    regressions:new URL("./corpus/", import.meta.url), numRuns:100,
    arbitrary:fc.record({
      stem:fc.constantFrom("device", "preview", "alpha", "beta"),
      expression:fc.constantFrom("template", "concat", "constant-concat"),
      wrapper:fc.constantFrom("join", "direct"),
      extension:fc.constantFrom("browser", "worker", "browser[1]"),
      moduleExtension:fc.constantFrom("ts", "mts"),
      matching:fc.boolean(),
      api:fc.constantFrom("config", "named", "namespace")
    }),
    check:({stem, expression, wrapper, extension, matching, api, moduleExtension}) => {
      const suffix = "." + extension + "." + moduleExtension
      const computed = expression === "template" ? '`${stem}' + suffix + '`'
        : expression === "constant-concat" ? JSON.stringify(stem) + ' + "' + suffix + '"' : 'stem + "' + suffix + '"'
      const input = wrapper === "join" ? 'NodePath.join(".", "src", ' + computed + ')' : computed
      const config = '{build:{lib:{entry:' + input + '}}}'
      const text = api === "named" ? 'import {build as bundle} from "vite-plus"; bundle(' + config + ')\n'
        : api === "namespace" ? 'import * as Vite from "vite"; Vite.build(' + config + ')\n'
        : 'export default ' + config + '\n'
      const f = fixture(null, text, "src/" + stem + (matching ? suffix : ".unrelated.ts"))
      f.put("vite.config.ts", text)
      f.options.tracked.push("vite.config.ts")
      try {
        const prepare = () => prepareState(f.target, [f.module], [f.module], f.options)
        if (matching) assert.throws(prepare, /computed build entry/)
        else { const state = prepare(); applyState(f.target, state); assert.ok(existsSync(join(f.target, state.renames[0].to))) }
        assert.equal(readFileSync(join(f.target, "vite.config.ts"), "utf8"), text)
      } finally { f.clean() }
    }
  })
})

test("computed data strings and protected tests do not act as build entrypoints", t => {
  for (const [file, text] of [
    ["src/data.ts", 'export const description = `${stem}.browser.ts`\n'],
    ["tests/vite.config.ts", 'export default {build:{lib:{entry:`${stem}.browser.ts`}}}\n']
  ]) {
    const f = fixture(t, "")
    f.put(file, text); f.options.tracked.push(file)
    assert.doesNotThrow(() => prepareState(f.target, [f.module], [f.module], f.options))
  }
})
