import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { repinVibeLang } from "../lib/upgrade.mjs"
import { upgradeEffect } from "../lib/steps.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, readJson, writeJson } from "../lib/util.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = readJson(new URL("./corpus/foldkit-peer-dependency-switch.json", import.meta.url))

test("foldkit-79: upgrade-effect keeps a published plugin peer range and optional metadata", async () => {
  const root = mkdtempSync(join(tmpdir(), "foldkit-peer-release-"))
  const target = join(root, "repo"), toolchain = join(root, "toolchain")
  try {
    mkdirSync(target); mkdirSync(toolchain)
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", {cwd:target})
    writeJson(join(target, "package.json"), {...corpus, dependencies:{effect:"4.0.6"}})
    writeFileSync(join(target, "bun.lock"), "")
    writeFileSync(join(target, ".gitignore"), ".vibelang-toolchain/\n")
    const base = await Jj.commit(target, "original foldkit plugin")
    writeFileSync(join(toolchain, "vibelang-new.tgz"), "tarball\n")
    writeJson(join(toolchain, "toolchain.json"), {version:"0.0.11",commit:"0123456789abcdef0123",effect:"4.0.6",compiler:"native/vibelang",packages:{vibelang:"vibelang-new.tgz"}})
    const result = await upgradeEffect({run:join(root,"run"),target,packages:["."],test:"true",toolchain,install:"true",base})
    const manifest = readJson(join(target,"package.json"))
    assert.deepEqual(manifest.peerDependencies, corpus.peerDependencies)
    assert.deepEqual(manifest.peerDependenciesMeta, corpus.peerDependenciesMeta)
    assert.match(manifest.devDependencies.vibelang,/^file:\.\/\.vibelang-toolchain\//)
    assert.ok(existsSync(join(target,manifest.devDependencies.vibelang.slice(5))))
    assert.ok(result.changed.includes("package.json"))
  } finally {rmSync(root,{recursive:true,force:true})}
})

test("foldkit-79: all adapter peers retain their range while installed dependencies repin", () => {
  fc.assert(fc.property(
    fc.constantFrom("vibelang","vibelang-runtime","vibelang-vite","vibelang-unplugin"),
    fc.constantFrom(">=0.0.11","^0.0.10","~0.0.9","*","0.0.10 || >=0.0.11"),
    fc.constantFrom("dependencies","devDependencies","optionalDependencies"),
    fc.boolean(), (name,range,field,optional) => {
      const before = {peerDependencies:{[name]:range},peerDependenciesMeta:{[name]:{optional}},[field]:{[name]:"0.0.10"}}
      const spec = "file:../.vibelang-toolchain/" + name + "-new.tgz"
      const result = repinVibeLang(JSON.stringify(before),{[name]:spec})
      const after = JSON.parse(result.text)
      assert.deepEqual(after.peerDependencies,before.peerDependencies)
      assert.deepEqual(after.peerDependenciesMeta,before.peerDependenciesMeta)
      assert.equal(after[field][name],field === "optionalDependencies" ? before[field][name] : spec)
      assert.equal(result.moved.length,field === "optionalDependencies" ? 0 : 1)
      assert.equal(repinVibeLang(result.text,{[name]:spec}).text,result.text)
    }), {seed:790011,numRuns:250})
})

// Optional and peer contracts remain portable; only direct development/runtime installs use staging.
test("a standalone optional VibeLang dependency never acquires a staged file URI", () => {
  for (const name of ["vibelang","vibelang-runtime","vibelang-vite","vibelang-unplugin"]) {
    const before = JSON.stringify({optionalDependencies:{[name]:"^0.0.10"}})
    const result = repinVibeLang(before,{[name]:"file:../staged/new.tgz"})
    assert.equal(result.text,before)
    assert.deepEqual(result.moved,[])
  }
})
