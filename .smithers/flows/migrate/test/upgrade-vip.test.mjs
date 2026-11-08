// A repository with .vibe modules keeps its installed predecessor compiler
// until upgrade-effect has checked it: a failing predecessor stops the run
// before any repin.
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, before, test } from "node:test"
import { upgradeEffect } from "../lib/steps.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")

// Keep capability tests offline: the installer still has to request the exact
// target dependencies, and the compiler below independently reads their pins.
const npmRoot = mkdtempSync(join(tmpdir(), "migrate-vip-installer-"))
const originalNpmPath = process.env.PATH
before(() => {
  writeFileSync(join(npmRoot, "npm"), `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path")
const args = process.argv.slice(2)
if (!args.includes("--ignore-scripts") || !args.includes("--package-lock=false")) process.exit(97)
const effect = args.find(arg => arg.startsWith("effect@"))?.slice(7)
const runtime = args.at(-1)
if (!effect || !runtime.endsWith(".tgz")) process.exit(98)
if (fs.readFileSync(runtime, "utf8").startsWith("fail-install")) { console.error("fixture dependency unavailable"); process.exit(37) }
const prefix = args[args.indexOf("--prefix") + 1]
for (const [name, version] of [["effect", effect], ["vibelang-runtime", "0.0.12"]]) {
  const dir = path.join(prefix, "node_modules", name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version }))
}
`, { mode: 0o755 })
  process.env.PATH = npmRoot + ":" + originalNpmPath
})
after(() => {
  process.env.PATH = originalNpmPath
  rmSync(npmRoot, { recursive: true, force: true })
})

function fakeCompiler(bin, { side, target, calls, fixCode = 0, probeCode = 0, declaration, version = "0.0.11", finishServices = false, expectedEffect, expectedRuntime }) {
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path")
const args = process.argv.slice(2)
if (args[0] === "--version") { console.log(${JSON.stringify(version)}); process.exit(0) }
const project = args[args.indexOf("-p") + 1]
if (args.includes("--emitDeclarationOnly") && project && fs.readFileSync(project, "utf8").includes("probe.vibe")) {
  const config = JSON.parse(fs.readFileSync(project, "utf8"))
  const source = path.join(path.dirname(project), "probe.vibe")
  if (config.files.join() !== "probe.vibe" || fs.readFileSync(source, "utf8") !== ${JSON.stringify("export const f = (n: number) => n + 1\n")}) process.exit(99)
  for (const [name, expected] of [["effect", ${JSON.stringify(expectedEffect)}], ["vibelang-runtime", ${JSON.stringify(expectedRuntime)}]]) {
    if (!expected) continue
    let actual
    try { actual = JSON.parse(fs.readFileSync(path.join(path.dirname(project), "node_modules", name, "package.json"), "utf8")).version } catch {}
    if (actual !== expected) { console.error("EK3201: " + name + " " + actual + " does not match " + expected); process.exit(2) }
  }
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
  writeFileSync(join(toolchain, "runtime-new.tgz"), "tarball\\n")
  writeJson(join(toolchain, "toolchain.json"), { version: "0.0.12", commit: "fedcba9876543210fedc", effect: "4.0.6", compiler: "native/vibelang", packages: { vibelang: "vibelang-new.tgz", "vibelang-runtime": "runtime-new.tgz" } })
  return { target, toolchain, base, calls }
}

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
