import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const directories = [".smithers", "packages/runtime", "packages/compiler", "experiments", "docs/tools"]

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-ci-install-"))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const root = path.join(temp, "checkout")
  const write = (name, text) => { fs.mkdirSync(path.dirname(name), { recursive: true }); fs.writeFileSync(name, text) }
  const executable = (name, text) => { write(name, text); fs.chmodSync(name, 0o755) }
  const installed = (dir, version) => write(path.join(dir, "effect/package.json"), JSON.stringify({ version }))
  for (const file of ["ci.sh", "check-effect-install.mjs"]) {
    write(path.join(root, "scripts", file), fs.readFileSync(new URL("./" + file, import.meta.url)))
  }
  for (const dir of directories) {
    write(path.join(root, dir, "package.json"), JSON.stringify({ devDependencies: { effect: "4.1.0" } }))
    installed(path.join(root, dir, "node_modules"), "4.1.0")
  }
  write(path.join(root, ".smithers/package.json"), "{}")
  write(path.join(root, "packages/runtime/package.json"), JSON.stringify({ peerDependencies: { effect: "4.1.0" } }))
  write(path.join(root, "packages/ts-mapper/package.json"), JSON.stringify({ devDependencies: { typescript: "7.1.0-beta" } }))
  executable(path.join(root, "packages/ts-mapper/test/.cache/typescript-7.1.0-beta/node_modules/.bin/tsc"), "#!/bin/sh\nexit 0\n")
  const smthrs = "#!/usr/bin/env node\nrequire(\"node:fs\").writeFileSync(process.env.CI_LOG, JSON.stringify(process.argv.slice(2)))\n"
  executable(path.join(root, ".smithers/node_modules/.bin/smthrs"), smthrs)
  const log = path.join(temp, "installs.jsonl")
  const ciLog = path.join(temp, "ci.json")
  const bun = path.join(temp, "bin/bun")
  // Record the actual install destination, then behave like a writing installer.
  executable(bun, `#!${process.execPath}
const fs = require("node:fs")
const dir = process.cwd()
const modules = fs.existsSync("node_modules") ? fs.realpathSync("node_modules") : null
fs.appendFileSync(process.env.INSTALL_LOG, JSON.stringify({ dir, modules, args: process.argv.slice(2) }) + "\\n")
if (dir.endsWith("/.smithers")) {
  fs.mkdirSync("node_modules/.bin", { recursive: true })
  fs.writeFileSync("node_modules/.bin/smthrs", ${JSON.stringify(smthrs)}, { mode: 0o755 })
} else {
  fs.mkdirSync("node_modules/effect", { recursive: true })
  fs.writeFileSync("node_modules/effect/package.json", JSON.stringify({ version: "4.1.0" }))
}
`)
  return {
    root, temp, installed,
    run() {
      const run = spawnSync("sh", ["scripts/ci.sh", "//packages:runtime-dist", "--jobs", "8"], {
        cwd: root, encoding: "utf8", timeout: 10000,
        env: { ...process.env, PATH: path.dirname(bun) + ":" + process.env.PATH, INSTALL_LOG: log, CI_LOG: ciLog }
      })
      assert.equal(run.status, 0, run.stdout + run.stderr)
      assert.deepEqual(JSON.parse(fs.readFileSync(ciLog, "utf8")).slice(0, 4), ["ci", "//packages:runtime-dist", "--jobs", "8"])
      return fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line)) : []
    }
  }
}

for (const kind of ["shared symlink", "local install", "missing install"]) {
  test("CI preserves a .smithers shared symlink and installs real or missing trees: " + kind, t => {
    const f = fixture(t)
    const modules = path.join(f.root, ".smithers/node_modules")
    const shared = path.join(f.temp, "shared/node_modules")
    if (kind === "shared symlink") {
      fs.mkdirSync(path.dirname(shared), { recursive: true })
      fs.renameSync(modules, shared)
      fs.symlinkSync(shared, modules, "dir")
    } else if (kind === "missing install") fs.rmSync(modules, { recursive: true })
    const calls = f.run()
    assert.ok(calls.every(call => call.modules !== shared), "bun install must never write into the shared install")
    assert.deepEqual(calls.map(call => call.dir), kind === "shared symlink" ? [] : [path.join(f.root, ".smithers")])
    for (const call of calls) assert.deepEqual(call.args, ["install", "--frozen-lockfile"])
    if (kind === "shared symlink") assert.equal(fs.readlinkSync(modules), shared)
  })
}

for (const dir of directories.slice(1)) {
  test("CI preserves a stale shared symlink in " + dir, t => {
    const f = fixture(t)
    const modules = path.join(f.root, dir, "node_modules")
    const shared = path.join(f.temp, "shared/node_modules")
    f.installed(shared, "4.0.6")
    fs.rmSync(modules, { recursive: true })
    fs.symlinkSync(shared, modules, "dir")
    assert.deepEqual(f.run().map(call => call.dir), [path.join(f.root, ".smithers")])
    assert.equal(fs.readlinkSync(modules), shared)
    assert.equal(JSON.parse(fs.readFileSync(path.join(shared, "effect/package.json"))).version, "4.0.6")
  })
}

for (const kind of ["stale", "matching", "missing"]) {
  test("CI checks the Effect pin of a local install: " + kind, t => {
    const f = fixture(t)
    const modules = path.join(f.root, "packages/runtime/node_modules")
    if (kind === "missing") fs.rmSync(modules, { recursive: true })
    else f.installed(modules, kind === "stale" ? "4.0.6" : "4.1.0")
    const expected = [path.join(f.root, ".smithers")]
    if (kind !== "matching") expected.push(path.join(f.root, "packages/runtime"))
    assert.deepEqual(f.run().map(call => call.dir), expected)
    assert.equal(JSON.parse(fs.readFileSync(path.join(modules, "effect/package.json"))).version, "4.1.0")
  })
}
