// opencode agent, 2026-11-01T01:00Z: a repository with .vibe modules that
// crosses from a pre-flip to a post-flip toolchain needs the earlier compiler's VIP migrations
// first, which only that compiler can make (VIP-1's unmarked Effect helpers).
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { probeVip1, probeTargetVip1 } from "../lib/vip-flip.mjs"
import { upgradeEffect } from "../lib/steps.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")

const quote = "it first runs the installed `vibelang --fix --fix-vip-only` on each project with a tracked `.vibe` file"

function fakeCompiler(bin, { side, target, calls, fixCode = 0, probeCode = 0, declaration, version = "0.0.11", finishServices = false }) {
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path")
const args = process.argv.slice(2)
if (args[0] === "--version") { console.log(${JSON.stringify(version)}); process.exit(0) }
const project = args[args.indexOf("-p") + 1]
if (args.includes("--emitDeclarationOnly") && project && fs.readFileSync(project, "utf8").includes("probe.vibe")) {
  const config = JSON.parse(fs.readFileSync(project, "utf8"))
  const source = path.join(path.dirname(project), "probe.vibe")
  if (config.files.join() !== "probe.vibe" || fs.readFileSync(source, "utf8") !== ${JSON.stringify("export const f = (n: number) => n + 1\n")}) process.exit(99)
  if (${probeCode}) process.exit(${probeCode})
  const out = args[args.indexOf("--outDir") + 1]
  fs.mkdirSync(out, { recursive: true })
  if (${declaration !== null}) fs.writeFileSync(path.join(out, "probe.d.ts"), ${JSON.stringify(declaration ?? (side === "pre" ? "export declare const f: (n: number) => Effect.Effect<number, never, never>;\n" : "export declare const f: (n: number) => number;\n"))})
  process.exit(0)
}
if (${finishServices} && !args.includes("--fix-vip-only") && args.includes("--noEmit")) {
 const file=path.join(${JSON.stringify(target)},"src/rule.vibe")
 if (fs.existsSync(file) && fs.readFileSync(file,"utf8").includes("try RuleContext()")) {
  console.log(file+"(3,18): error TS2348: service class is not callable")
  process.exit(2)
 }
}
if (!args.includes("--fix-vip-only")) process.exit(0)
if (${fixCode}) process.exit(${fixCode})
const target = ${JSON.stringify(target)}, calls = ${JSON.stringify(calls)}
if (calls) fs.appendFileSync(calls, process.cwd() + "|" + args.join(" ") + "|" + path.basename(JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8")).dependencies.vibelang) + ${JSON.stringify("\n")})
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(file)
    else if (file.endsWith(".vibe")) fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^export function unwrap/m, "export effect function unwrap").replace(/\\.map\\(\\(/g, ".map(effect ("))
  }
}
walk(process.cwd())
if (${finishServices}) {
 function finish(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
   if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
   const file = path.join(dir, entry.name)
   if (entry.isDirectory()) finish(file)
   else if (file.endsWith(".vibe")) fs.writeFileSync(file, fs.readFileSync(file, "utf8").replaceAll("try RuleContext()", "try RuleContext"))
  }
 }
 finish(process.cwd())
}
`, { mode: 0o755 })
}

// A target set up by an earlier toolchain, its installed vibelang a stand-in
// that records each call, the manifest it sees, and marks the helper it fixes.
async function fixture(root, files) {
  const target = join(root, "repo")
  const toolchain = join(root, "toolchain")
  mkdirSync(target)
  mkdirSync(toolchain)
  await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
  writeFileSync(join(target, "package.json"), JSON.stringify({ name: "fixture", private: true, dependencies: { effect: "4.0.6", vibelang: "file:./.vibelang-toolchain/vibelang-old.tgz" } }))
  writeFileSync(join(target, "bun.lock"), "")
  writeFileSync(join(target, ".gitignore"), ".vibelang-toolchain/\nnode_modules/\n")
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(target, file, ".."), { recursive: true })
    writeFileSync(join(target, file), text)
  }
  const calls = join(root, "calls.log")
  const bin = join(target, "node_modules/.bin/vibelang")
  mkdirSync(join(bin, ".."), { recursive: true })
  fakeCompiler(bin, { side: "pre", target, calls })
  // Existing native projects are checked before repinning, and with the staged compiler afterward.
  symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
  mkdirSync(join(toolchain, "native"), { recursive: true })
  fakeCompiler(join(toolchain, "native/vibelang"), { side: "post" })
  const base = await Jj.commit(target, "base")
  writeFileSync(join(toolchain, "vibelang-new.tgz"), "tarball\n")
  writeJson(join(toolchain, "toolchain.json"), { version: "0.0.12", commit: "fedcba9876543210fedc", effect: "4.0.6", compiler: "native/vibelang", packages: { vibelang: "vibelang-new.tgz" } })
  return { target, toolchain, base, calls }
}

// docs/design/src/900-appendices.md#11bbf54371f13339 — Chapter 900: an upgrade may adapt preexisting Vibe sources without new conversions.
test("upgrade-effect runs the installed compiler's VIP migrations on the earlier run's .vibe modules before repinning", async () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(quote), "update the quoted step rule")
  const root = mkdtempSync(join(tmpdir(), "migrate-vip-switch-"))
  try {
    // opencode's ai protocols: an unmarked helper that unwraps an Effect, which only the pre-VIP-1 compiler knows to mark.
    const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-vip1-unmarked-helper.json", import.meta.url), "utf8"))
    const helper = corpus.before
    const { target, toolchain, base, calls } = await fixture(root, {
      "packages/ai/tsconfig.json": "{}\n",
      "packages/ai/src/helper.vibe": helper,
      "packages/ai/src/plain.ts": "export const x = 1\n",
      "packages/core/tsconfig.json": "{}\n",
      "packages/core/src/index.ts": "export const y = 2\n"
    })
    const result = await upgradeEffect({ run: join(root, "run"), target, packages: ["."], test: "true", testCwd: ".", toolchain, install: "true", base })
    // Once, for the one project with a .vibe file, before the manifest names the new tarball.
    assert.deepEqual(readFileSync(calls, "utf8").trim().split("\n"),
      [`${join(target, "packages/ai")}|-p ${join(target, "packages/ai/tsconfig.json")} --fix --fix-vip-only --noEmit --pretty false|vibelang-old.tgz`])
    const { probes, ...vipFixes } = result.vipFixes
    assert.deepEqual(vipFixes, { changed: ["packages/ai/src/helper.vibe"], projects: ["packages/ai/tsconfig.json"], failed: [] })
    assert.equal(probes.target.side, "post")
    assert.equal(probes.installed[0].side, "pre")
    assert.deepEqual(result.changed.sort(), ["package.json", "packages/ai/src/helper.vibe"])
    assert.equal(readFileSync(join(target, "packages/ai/src/helper.vibe"), "utf8"), corpus.after)
    const { stdout } = await must(`jj log -r ${result.jj.commit} --no-graph -T description`, { cwd: target })
    assert.match(stdout, /^migrate\(vibelang\): switch to the toolchain of VibeLang fedcba987654\n/)
    assert.match(stdout, /First applies the earlier toolchain's VIP migrations\n\(vibelang --fix --fix-vip-only\) to 1 \.vibe file\./)
    const { stdout: files } = await must(`jj diff -r ${result.jj.commit} --summary`, { cwd: target })
    assert.deepEqual(files.trim().split("\n").sort(), ["M package.json", "M packages/ai/src/helper.vibe"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("upgrade-effect leaves a repository with no .vibe module to the new toolchain alone", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-vip-switch-"))
  try {
    const { target, toolchain, base, calls } = await fixture(root, { "tsconfig.json": "{}\n", "src/index.ts": "export const y = 2\n" })
    const result = await upgradeEffect({ run: join(root, "run"), target, packages: ["."], test: "true", testCwd: ".", toolchain, install: "true", base })
    assert.equal(existsSync(calls), false)
    assert.deepEqual(result.vipFixes, { changed: [], projects: [], failed: [] })
    const { stdout } = await must(`jj log -r ${result.jj.commit} --no-graph -T description`, { cwd: target })
    assert.doesNotMatch(stdout, /VIP migrations/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a project whose installed compiler is missing or fails is named, and the switch goes on", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-vip-switch-"))
  try {
    const { target, toolchain, base } = await fixture(root, { "packages/ai/tsconfig.json": "{}\n", "packages/ai/src/helper.vibe": "export const v = 1\n" })
    fakeCompiler(join(target, "node_modules/.bin/vibelang"), { side: "pre", fixCode: 2 })
    const result = await upgradeEffect({ run: join(root, "run"), target, packages: ["."], test: "true", testCwd: ".", toolchain, install: "true", base })
    const { probes, ...vipFixes } = result.vipFixes
    assert.deepEqual(vipFixes, { changed: [], projects: ["packages/ai/tsconfig.json"], failed: [{ project: "packages/ai/tsconfig.json", code: 2 }] })
    assert.equal(probes.target.side, "post")
    assert.deepEqual(result.changed, ["package.json"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a predecessor baseline failure never repins an existing native project", async () => {
  // The baseline guard must run before the old compiler's one-time VIP rewrite.
  await fc.assert(fc.asyncProperty(fc.constantFrom(1, 2, 137), fc.boolean(), async (code, version) => {
    const root = mkdtempSync(join(tmpdir(), "migrate-vip-preflight-"))
    try {
      const { target, toolchain, base } = await fixture(root, { "tsconfig.json": "{}\n", "src/helper.vibe": "export const v = 1\n" })
      const manifest = readFileSync(join(target, "package.json"), "utf8")
      writeFileSync(join(target, "node_modules/.bin/vibelang"),
        "#!/bin/sh\n" + (version ? "" : 'if [ "$1" = "--version" ]; then echo 0.0.11; exit 0; fi\n') + "exit " + code + "\n")
      await assert.rejects(upgradeEffect({ run: join(root, "run"), target, packages: ["."], test: "true", toolchain, install: "true", base }))
      assert.equal(readFileSync(join(target, "package.json"), "utf8"), manifest)
      assert.equal(readFileSync(join(target, "src/helper.vibe"), "utf8"), "export const v = 1\n")
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { seed: 1049759, numRuns: 12 })
})


// alchemy-56: a same-era switch must never run the destructive predecessor fixer.
test("pre-flip to pre-flip preserves alchemy's pure map callbacks byte for byte", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-vip-alchemy-"))
  try {
    const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-preflip-map-callback.json", import.meta.url), "utf8"))
    const { target, toolchain, base, calls } = await fixture(root, { "tsconfig.json": "{}\n", "src/api.vibe": corpus.before })
    fakeCompiler(join(toolchain, "native/vibelang"), { side: "pre", version: "0.0.12" })
    const result = await upgradeEffect({ run: join(root, "run"), target, packages: ["."], test: "true", toolchain, install: "true", base })
    assert.equal(existsSync(calls), false, "same-side switches must not invoke --fix-vip-only")
    assert.equal(readFileSync(join(target, "src/api.vibe"), "utf8"), corpus.before)
    assert.equal(result.vipFixes.skipped, "same side of the flip")
    assert.deepEqual(result.vipFixes.changed, [])
    assert.deepEqual(JSON.parse(readFileSync(join(root, "run/upgrade-effect.json"), "utf8")).vipFixes, result.vipFixes)
  } finally { rmSync(root, { recursive: true, force: true }) }
})


// VIP-1 (docs/design/src/001-functions.md): "A function's kind is decided by a
// keyword on the function, never by its body or by a type."
// The transition oracle comes from the upgrade-effect rule quoted above;
// callback spelling, release versions and module count cannot select a migration.
test("VIP-1 transition property across compiler sides and callback shapes", async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom(["pre", "pre"], ["pre", "post"], ["post", "post"], ["post", "pre"]),
    fc.integer({ min: -1000, max: 1000 }), fc.constantFrom("0.0.11", "0.0.12", "99.0.0"),
    async ([previous, next], offset, version) => {
      const root = mkdtempSync(join(tmpdir(), "migrate-vip-sides-"))
      try {
        const before = `export const orders = [{ id: ${offset} }].map((item) => ({ id: item.id + ${offset} }))\n`
        const { target, toolchain, base, calls } = await fixture(root, { "tsconfig.json": "{}\n", "src/api.vibe": before })
        fakeCompiler(join(target, "node_modules/.bin/vibelang"), { side: previous, target, calls, version })
        fakeCompiler(join(toolchain, "native/vibelang"), { side: next, version })
        const result = await upgradeEffect({ run: join(root, "run"), target, packages: ["."], test: "true", toolchain, install: "true", base })
        const crosses = previous === "pre" && next === "post"
        assert.equal(existsSync(calls), crosses)
        assert.equal(readFileSync(join(target, "src/api.vibe"), "utf8"), crosses ? before.replace(".map((", ".map(effect (") : before)
        assert.equal(result.vipFixes.probes.target.side, next)
        assert.equal(result.vipFixes.probes.installed[0].side, previous)
        assert.deepEqual(result.vipFixes.projects, crosses ? ["tsconfig.json"] : [])
      } finally { rmSync(root, { recursive: true, force: true }) }
    }), { seed: 560101, numRuns: 24 })
})

for (const which of ["installed", "target"]) {
  test(`a failed ${which} probe skips the migration and records the error`, async () => {
    const root = mkdtempSync(join(tmpdir(), "migrate-vip-probe-error-"))
    try {
      const before = "export const ids = items.map((item) => item.id)\n"
      const { target, toolchain, base, calls } = await fixture(root, { "tsconfig.json": "{}\n", "src/api.vibe": before })
      const bin = which === "installed" ? join(target, "node_modules/.bin/vibelang") : join(toolchain, "native/vibelang")
      fakeCompiler(bin, { side: which === "installed" ? "pre" : "post", target, calls, probeCode: 2 })
      const result = await upgradeEffect({ run: join(root, "run"), target, packages: ["."], test: "true", toolchain, install: "true", base })
      assert.equal(existsSync(calls), false)
      assert.equal(readFileSync(join(target, "src/api.vibe"), "utf8"), before)
      assert.match(result.vipFixes.skipped, /VIP-1 probe exited 2/)
      assert.deepEqual(result.vipFixes.changed, [])
      const recorded = JSON.parse(readFileSync(join(root, "run/upgrade-effect.json"), "utf8"))
      assert.equal(recorded.vipFixes.skipped, result.vipFixes.skipped)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}

test("the probe reads declarations, including imported Effect types and misleading comments", async () => {
  const ts = require("typescript")
  const root = mkdtempSync(join(tmpdir(), "migrate-vip-probe-"))
  try {
    const bin = join(root, "vibelang")
    for (const [declaration, expected] of [
      ["export declare const f: (n: number) => Effect.Effect<number, never, never>;\n", "pre"],
      ['export declare const f: (n: number) => import("effect").Effect.Effect<number, never, never>;\n', "pre"],
      ["/** Effect.Effect<number> */\nexport declare const f: (n: number) => number;\n", "post"],
      ["export declare const f: (n: number) => any;\n", undefined],
      ["export declare const f: (n: number) => unknown;\n", undefined],
      ["export declare const f: (n: number) => number | Effect.Effect<number>;\n", undefined],
      ["export declare const g: (n: number) => number;\n", undefined],
      ["// export declare const f: (n: number) => number;\n", undefined],
      [null, undefined],
    ]) {
      fakeCompiler(bin, { declaration })
      const result = await probeVip1({ compiler: bin, directory: root, log: join(root, "probe.log"), ts })
      assert.equal(result.side, expected, declaration)
      assert.equal(Boolean(result.error), expected === undefined)
    }
    for (const probeCode of [1, 2, 137]) {
      fakeCompiler(bin, { probeCode })
      const result = await probeVip1({ compiler: bin, directory: root, log: join(root, "probe.log"), ts })
      assert.equal(result.error, `VIP-1 probe exited ${probeCode}`)
      assert.match(readFileSync(result.log, "utf8"), new RegExp("# exit " + probeCode))
    }
    assert.deepEqual(readdirSync(root).filter(name => name.startsWith("vip1-probe-")), [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("the probe records a missing compiler and a timeout without guessing the flip side", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-vip-probe-refusal-"))
  const ts = require("typescript")
  try {
    const bin = join(root, "missing")
    const missing = await probeVip1({ compiler: bin, directory: root, ts })
    assert.equal(missing.error, "VIP-1 probe exited 127")
    writeFileSync(bin, "#!/bin/sh\nsleep 10\n", { mode: 0o755 })
    const timeout = await probeVip1({ compiler: bin, directory: root, ts, timeoutMs: 30 })
    assert.equal(timeout.error, "VIP-1 probe exited 124 (timed out)")
    assert.deepEqual(readdirSync(root).filter(name => name.startsWith("vip1-probe-")), [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("projects with different installed compilers are gated independently", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-vip-mixed-"))
  try {
    const before = "export function unwrap(id: string) { return try load(id) }\n"
    const { target, toolchain, base, calls } = await fixture(root, {
      "packages/ai/tsconfig.json": "{}\n", "packages/ai/src/helper.vibe": before,
      "packages/core/tsconfig.json": "{}\n", "packages/core/src/helper.vibe": before
    })
    const coreCompiler = join(target, "packages/core/node_modules/.bin/vibelang")
    mkdirSync(dirname(coreCompiler), { recursive: true })
    fakeCompiler(coreCompiler, { side: "post", target, calls })
    const result = await upgradeEffect({ run: join(root, "run"), target, packages: ["."], test: "true", toolchain, install: "true", base })
    assert.deepEqual(result.vipFixes.changed, ["packages/ai/src/helper.vibe"])
    assert.deepEqual(result.vipFixes.projects, ["packages/ai/tsconfig.json"])
    assert.deepEqual(result.vipFixes.skippedProjects, [{ project: "packages/core/tsconfig.json", reason: "same side of the flip" }])
    assert.equal(readFileSync(join(target, "packages/core/src/helper.vibe"), "utf8"), before)
    assert.equal(result.vipFixes.probes.installed.length, 2)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("an npm target probes its requested release in isolation, not the installed predecessor", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-vip-npm-"))
  const originalPath = process.env.PATH
  try {
    const requested = join(root, "requested")
    fakeCompiler(requested, { side: "post", version: "0.0.11" })
    const npm = join(root, "npm")
    writeFileSync(npm, `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path")
const args = process.argv.slice(2)
if (!args.includes("vibelang@0.0.11")) process.exit(99)
const prefix = args[args.indexOf("--prefix") + 1]
const bin = path.join(prefix, "node_modules/.bin/vibelang")
fs.mkdirSync(path.dirname(bin), { recursive: true })
fs.copyFileSync(${JSON.stringify(requested)}, bin)
fs.chmodSync(bin, 0o755)
`, { mode: 0o755 })
    process.env.PATH = root + ":" + originalPath
    const result = await probeTargetVip1({ toolchain: { kind: "npm", version: "0.0.11" },
      directory: root, log: join(root, "npm-probe.log"), ts: require("typescript") })
    assert.equal(result.side, "post")
    assert.deepEqual(readdirSync(root).filter(name => /^vip1-(target|probe)-/.test(name)), [])
  } finally {
    process.env.PATH = originalPath
    rmSync(root, { recursive: true, force: true })
  }
})


test("foldkit: the new compiler finishes service lookups before the upgraded build", async () => {
 const root=mkdtempSync(join(tmpdir(),"migrate-foldkit-service-finish-"))
 try {
  const corpus=JSON.parse(readFileSync(new URL("./corpus/foldkit-rulecontext-transition.json",import.meta.url),"utf8"))
  const {target,toolchain,base,calls}=await fixture(root,{
   "tsconfig.json":"{}\n","src/rule.vibe":corpus.before
  })
  fakeCompiler(join(toolchain,"native/vibelang"),{side:"post",target,calls,finishServices:true})
  const manifest=JSON.parse(readFileSync(join(target,"package.json"),"utf8"))
  manifest.scripts={"build:packages":"node check-build.cjs"}
  writeJson(join(target,"package.json"),manifest)
  writeFileSync(join(target,"check-build.cjs"),"const fs=require('node:fs');const p=JSON.parse(fs.readFileSync('package.json'));if(!p.dependencies.vibelang.includes('vibelang-old.tgz')&&fs.readFileSync('src/rule.vibe','utf8').includes('try RuleContext()')){console.error('retired RuleContext() survived SDK transition');process.exit(2)}\n")
  const start=await Jj.commit(target,"service transition build contract")
  const result=await upgradeEffect({run:join(root,"run"),target,packages:["."],test:"true",toolchain,install:"true",base:start??base}).catch(error=>{
    const logs=join(root,"run/baseline/logs")
    error.message += "\n"+readdirSync(logs).filter(name=>name.startsWith("vip-finish")).map(name=>name+"\n"+readFileSync(join(logs,name),"utf8")).join("\n")
    throw error
  })
  assert.equal(readFileSync(join(target,"src/rule.vibe"),"utf8"),corpus.after)
  assert.deepEqual(readFileSync(calls,"utf8").trim().split("\n").map(line=>line.split("|").at(-1)),["vibelang-old.tgz",JSON.parse(readFileSync(join(target,"package.json"),"utf8")).dependencies.vibelang.split("/").at(-1)])
  assert.deepEqual(result.vipFinish.changed,["src/rule.vibe"])
  assert.deepEqual(result.vipFinish.projects,["tsconfig.json"])
  assert.deepEqual(result.vipFinish.failed,[])
  assert.ok(result.changed.includes("src/rule.vibe"))
  const receipt=JSON.parse(readFileSync(join(root,"run/baseline/logs/vip-finish.json"),"utf8"))
  assert.equal(receipt.state,"complete")
  assert.deepEqual(receipt.changed,["src/rule.vibe"])
  assert.equal(receipt.checks["tsconfig.json"].code,2)
  assert.equal(await Jj.fileAt(target,result.jj.commit,"src/rule.vibe"),corpus.after)
 } finally {rmSync(root,{recursive:true,force:true})}
})


// Chapter 7: "Every breaking change ships a `vibelang --fix` codemod, so code
// that compiled under the previous release migrates mechanically."
// The predecessor alone can recover function kind; the new compiler finishes
// its retired service operands before compilation becomes a new baseline.
test("foldkit service transition property covers compiler eras and native siblings", async () => {
 await fc.assert(fc.asyncProperty(
  fc.constantFrom(["pre","pre"],["pre","post"],["post","post"],["post","pre"]),
  fc.integer({min:1,max:5}),fc.integer({min:-1000,max:1000}),
  async ([previous,next],count,offset)=>{
   const root=mkdtempSync(join(tmpdir(),"migrate-foldkit-service-property-"))
   try {
    const corpus=JSON.parse(readFileSync(new URL("./corpus/foldkit-rulecontext-transition.json",import.meta.url),"utf8"))
    const crossing=previous==="pre"&&next==="post"
    const original=previous==="pre"?corpus.before:corpus.after
    const files={"tsconfig.json":"{}\n","src/rule.vibe":original,"src/control.ts":'export const text = "try RuleContext()"\n'}
    for(let i=1;i<count;i++)files["src/peer"+i+".vibe"]=original+"// sibling "+(offset+i)+"\n"
    const {target,toolchain,base,calls}=await fixture(root,files)
    fakeCompiler(join(target,"node_modules/.bin/vibelang"),{side:previous,target,calls})
    fakeCompiler(join(toolchain,"native/vibelang"),{side:next,target,calls,finishServices:next==="post"})
    const result=await upgradeEffect({run:join(root,"run"),target,packages:["."],test:"true",toolchain,install:"true",base})
    for(const [file,before] of Object.entries(files)) {
     const wanted=crossing&&file.endsWith(".vibe")?before.replaceAll("try RuleContext()","try RuleContext"):before
     assert.equal(readFileSync(join(target,file),"utf8"),wanted,file)
    }
    assert.deepEqual(result.vipFinish?.projects??[],crossing?["tsconfig.json"]:[])
    assert.equal(result.vipFinish?.changed.length??0,crossing?count:0)
    assert.deepEqual(result.vipFinish?.failed??[],[])
    assert.equal(existsSync(calls),crossing)
    if(crossing)assert.equal(readFileSync(calls,"utf8").trim().split("\n").length,2)
   } finally {rmSync(root,{recursive:true,force:true})}
  }
 ),{seed:413947,numRuns:40})
})
