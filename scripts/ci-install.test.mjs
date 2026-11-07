import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const directories = [".smithers", "packages/runtime", "packages/compiler", "packages/compiler/test/tools", "packages/create-vibelang", "packages/vite", "experiments", "docs/tools"]
// Companion probes load the plugin helpers from their owning package.
directories.push("packages/unplugin")

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-ci-install-"))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const root = path.join(temp, "checkout")
  const write = (name, text) => { fs.mkdirSync(path.dirname(name), { recursive: true }); fs.writeFileSync(name, text) }
  const executable = (name, text) => { write(name, text); fs.chmodSync(name, 0o755) }
  const installed = (dir, version) => write(path.join(dir, "effect/package.json"), JSON.stringify({ version }))
  // Keep the old helper when testing the regression against an older checkout.
  const files = ["ci.sh", "share-effect.mjs"]
  if (fs.existsSync(new URL("./check-effect-install.mjs", import.meta.url))) files.push("check-effect-install.mjs")
  for (const file of files) {
    write(path.join(root, "scripts", file), fs.readFileSync(new URL("./" + file, import.meta.url)))
  }
  for (const dir of directories) {
    write(path.join(root, dir, "package.json"), JSON.stringify({ devDependencies: { effect: "4.1.1" } }))
    installed(path.join(root, dir, "node_modules"), "4.1.1")
  }
  write(path.join(root, ".smithers/package.json"), "{}")
  write(path.join(root, "packages/runtime/package.json"), JSON.stringify({ peerDependencies: { effect: "4.1.1" } }))
  write(path.join(root, "packages/ts-mapper/package.json"), JSON.stringify({ devDependencies: { typescript: "7.1.0-beta" } }))
  for (const version of ["7.1.0-beta", "7.0.2"]) {
    executable(path.join(root, "packages/ts-mapper/test/.cache/typescript-" + version + "/node_modules/.bin/tsc"), "#!/bin/sh\nexit 0\n")
  }
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
  fs.writeFileSync("node_modules/effect/package.json", JSON.stringify({ version: "4.1.1" }))
}
`)
  return {
    root, temp, installed,
    run(timeout = 30000, prepareOnly = false) {
      const start = performance.now()
      const run = spawnSync("sh", ["scripts/ci.sh", ...(prepareOnly ? ["--prepare-only"] : ["//packages:runtime-dist", "--jobs", "8"])], {
        cwd: root, encoding: "utf8", timeout,
        env: { ...process.env, PATH: path.dirname(bun) + ":" + process.env.PATH, INSTALL_LOG: log, CI_LOG: ciLog }
      })
      const calls = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : []
      assert.equal(run.status, 0, "CI fixture failed: " + JSON.stringify({
        elapsedMilliseconds: Math.round(performance.now() - start),
        status: run.status, signal: run.signal, errorCode: run.error?.code ?? null,
        startedInstallers: calls.map(call => path.relative(root, call.dir)),
        stdout: run.stdout, stderr: run.stderr,
      }))
      if (prepareOnly) assert.equal(fs.existsSync(ciLog), false, "preparation never starts the graph")
      else assert.deepEqual(JSON.parse(fs.readFileSync(ciLog, "utf8")).slice(0, 4), ["ci", "//packages:runtime-dist", "--jobs", "8"])
      return calls
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
    assert.deepEqual(calls.map(call => call.dir), directories.filter(dir => kind !== "shared symlink" || dir !== ".smithers").map(dir => path.join(f.root, dir)))
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
    assert.deepEqual(f.run().map(call => call.dir), directories.filter(candidate => candidate !== dir).map(candidate => path.join(f.root, candidate)))
    assert.equal(fs.readlinkSync(modules), shared)
    assert.equal(JSON.parse(fs.readFileSync(path.join(shared, "effect/package.json"))).version, "4.0.6")
  })
}

for (const kind of ["stale", "matching", "missing"]) {
  test("CI frozen-verifies a local install, including a matching Effect pin: " + kind, t => {
    const f = fixture(t)
    const modules = path.join(f.root, "packages/runtime/node_modules")
    if (kind === "missing") fs.rmSync(modules, { recursive: true })
    else f.installed(modules, kind === "stale" ? "4.0.6" : "4.1.1")
    const expected = directories.map(dir => path.join(f.root, dir))
    assert.deepEqual(f.run().map(call => call.dir), expected)
    assert.equal(JSON.parse(fs.readFileSync(path.join(modules, "effect/package.json"))).version, "4.1.1")
  })
}


test("CI verifies a changed non-Effect dependency even when the Effect pin matches", t => {
  const f = fixture(t)
  const dir = path.join(f.root, "experiments")
  const manifest = path.join(dir, "package.json")
  const data = JSON.parse(fs.readFileSync(manifest, "utf8"))
  data.devDependencies["fixture-tool"] = "2.0.0"
  fs.writeFileSync(manifest, JSON.stringify(data))
  fs.writeFileSync(path.join(dir, "bun.lock"), "updated-lockfile")
  const calls = f.run()
  assert.ok(calls.some(call => call.dir === dir), "an Effect version match does not prove a lockfile match")
  assert.deepEqual(calls.find(call => call.dir === dir).args, ["install", "--frozen-lockfile"])
})

test("CI never runs an installer through provisioned shared trees", t => {
  const f = fixture(t)
  for (const dir of directories) {
    const modules = path.join(f.root, dir, "node_modules")
    const shared = path.join(f.temp, "shared", dir, "node_modules")
    fs.mkdirSync(path.dirname(shared), { recursive: true })
    fs.renameSync(modules, shared)
    fs.symlinkSync(shared, modules, "dir")
  }
  assert.deepEqual(f.run(), [])
  for (const dir of directories) assert.ok(fs.lstatSync(path.join(f.root, dir, "node_modules")).isSymbolicLink())
})

for (const mode of ["graph", "prepare"]) {
  test("real Bun prepares fresh, stale and unchanged trees: " + mode, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibe ci real install-"))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const put = (name, data) => {
      const target = path.join(root, name)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, data)
      return target
    }
    const manifest = (name, data) => put(name + "/package.json", JSON.stringify(data) + "\n")
    for (const name of ["ci.sh", "share-effect.mjs", "check-effect-install.mjs"]) {
      const source = new URL("./" + name, import.meta.url)
      if (fs.existsSync(source)) put("scripts/" + name, fs.readFileSync(source))
    }
    for (const [name, version] of [["effect", "4.1.0"], ["tool-v1", "1.0.0"], ["tool-v2", "2.0.0"]]) {
      manifest("deps/" + name, { name: name === "effect" ? name : "fixture-tool", version })
    }
    manifest("deps/router", { name: "@tanstack/router-generator", version: "1.0.0" })
    manifest("deps/smthrs", { name: "fixture-smthrs", version: "1.0.0", bin: { smthrs: "cli.cjs" } })
    fs.chmodSync(put("deps/smthrs/cli.cjs", "#!" + process.execPath + "\n" +
      'require("node:fs").appendFileSync(process.env.CI_REAL_TRACE, JSON.stringify(process.argv.slice(2)) + "\\n")\n'), 0o755)
    const manifests = new Map()
    for (const dir of directories) {
      const dependencies = { effect: "file:" + path.join(root, "deps/effect") }
      if (dir === ".smithers") dependencies["fixture-smthrs"] = "file:" + path.join(root, "deps/smthrs")
      if (dir === "packages/compiler/test/tools") dependencies["@tanstack/router-generator"] = "file:" + path.join(root, "deps/router")
      if (dir === "experiments") dependencies["fixture-tool"] = "file:" + path.join(root, "deps/tool-v1")
      manifests.set(dir, { private: true, dependencies })
      manifest(dir, manifests.get(dir))
      const installed = spawnSync("bun", ["install", "--no-cache"], {
        cwd: path.join(root, dir), encoding: "utf8", timeout: 30_000
      })
      assert.equal(installed.status, 0, installed.stdout + installed.stderr)
    }
    manifest("packages/ts-mapper", { devDependencies: { typescript: "7.1.0-fixture" } })
    for (const version of ["7.1.0-fixture", "7.0.2"]) {
      fs.chmodSync(put("packages/ts-mapper/test/.cache/typescript-" + version + "/node_modules/.bin/tsc", "#!/bin/sh\nexit 0\n"), 0o755)
    }
    const installedVersion = name => JSON.parse(fs.readFileSync(path.join(root, "experiments/node_modules", name, "package.json"), "utf8")).version
    const trace = path.join(root, "graph.jsonl")
    if (mode === "prepare") {
      for (const dir of directories) fs.rmSync(path.join(root, dir, "node_modules"), { recursive: true })
      const fresh = spawnSync("sh", ["scripts/ci.sh", "--prepare-only"], {
        cwd: root, encoding: "utf8", timeout: 30_000,
        env: { ...process.env, CI_REAL_TRACE: trace }
      })
      assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr)
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, "packages/compiler/test/tools/node_modules/@tanstack/router-generator/package.json"), "utf8")).version, "1.0.0", "fresh preparation must install the native router adapter")
      for (const dir of directories) {
        assert.equal(JSON.parse(fs.readFileSync(path.join(root, dir, "node_modules/effect/package.json"), "utf8")).version, "4.1.0")
      }
      assert.equal(installedVersion("fixture-tool"), "1.0.0")
      assert.equal(fs.existsSync(trace), false)
    }
    manifests.get("experiments").dependencies["fixture-tool"] = "file:" + path.join(root, "deps/tool-v2")
    manifest("experiments", manifests.get("experiments"))
    const lock = spawnSync("bun", ["install", "--lockfile-only", "--no-cache"], {
      cwd: path.join(root, "experiments"), encoding: "utf8", timeout: 30_000
    })
    assert.equal(lock.status, 0, lock.stdout + lock.stderr)
    assert.equal(installedVersion("fixture-tool"), "1.0.0", "fixture must retain the old installation after the lockfile update")
    for (const phase of ["repair", "unchanged"]) {
      const start = performance.now()
      const result = spawnSync("sh", ["scripts/ci.sh", ...(mode === "prepare" ? ["--prepare-only"] : ["//fixture", "--jobs", "8"])], {
        cwd: root, encoding: "utf8", timeout: 30_000,
        env: {
          ...process.env, CI_REAL_TRACE: trace,
          // Preparation must not inspect a gate path list or start graph targets.
          ...(mode === "prepare" ? { CI_CHANGED_PATHS: path.join(root, "absent-paths.txt") } : {})
        }
      })
      t.diagnostic(phase + " CI: " + (performance.now() - start).toFixed(0) + " ms (local fixture packages)")
      assert.equal(result.status, 0, result.stdout + result.stderr)
      for (const dir of directories) {
        assert.equal(JSON.parse(fs.readFileSync(path.join(root, dir, "node_modules/effect/package.json"), "utf8")).version, "4.1.0")
      }
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, "packages/compiler/test/tools/node_modules/@tanstack/router-generator/package.json"), "utf8")).version, "1.0.0", "native router discovery must have its prepared adapter dependency")
      assert.ok(fs.lstatSync(path.join(root, "packages/runtime/node_modules/effect")).isSymbolicLink(),
        "preparation must share Effect before an individual check runs")
      assert.equal(installedVersion("fixture-tool"), "2.0.0", "CI must install the current lockfile before running the graph")
    }
    if (mode === "prepare") {
      assert.equal(fs.existsSync(trace), false, "preparation must never dispatch the graph")
      const manifestPath = path.join(root, "experiments/package.json")
      const broken = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
      broken.dependencies["fixture-tool"] = "file:" + path.join(root, "deps/tool-v1")
      fs.writeFileSync(manifestPath, JSON.stringify(broken))
      const refused = spawnSync("sh", ["scripts/ci.sh", "--prepare-only"], {
        cwd: root, encoding: "utf8", timeout: 30_000,
        env: { ...process.env, CI_REAL_TRACE: trace }
      })
      assert.equal(refused.status, 1, refused.stdout + refused.stderr)
      assert.match(refused.stderr, /lockfile|frozen/i, "retain the real installer's refusal")
      assert.equal(fs.existsSync(trace), false)
    } else {
      assert.deepEqual(fs.readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line)),
        Array.from({ length: 2 }, () => ["ci", "//fixture", "--jobs", "8", "--workspace", root, "--ui", "plain"]))
    }
  })
}

test("CI fixture retains shared install assertions after a slow installer starts", t => {
  const f = fixture(t)
  const modules = path.join(f.root, ".smithers/node_modules")
  const shared = path.join(f.temp, "shared/node_modules")
  fs.mkdirSync(path.dirname(shared), { recursive: true })
  fs.renameSync(modules, shared)
  fs.symlinkSync(shared, modules, "dir")
  const bun = path.join(f.temp, "bin/bun")
  const source = fs.readFileSync(bun, "utf8")
  // A deliberately slow process start models contention, not an installer error.
  fs.writeFileSync(bun, source.replace("\n", "\n" +
    'if (process.cwd().endsWith("/packages/runtime")) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 11000)\n'))
  const calls = f.run()
  assert.deepEqual(calls.map(call => call.dir), directories.slice(1).map(dir => path.join(f.root, dir)))
  assert.ok(calls.every(call => call.modules !== shared))
  assert.equal(fs.readlinkSync(modules), shared)
  for (const call of calls) assert.deepEqual(call.args, ["install", "--frozen-lockfile"])
})

for (const dir of [".smithers", "packages/runtime", "docs/tools"]) {
  for (const status of [7, 143]) {
    test("CI fixture diagnoses installer exit " + status + " at " + dir, t => {
      const f = fixture(t)
      const bun = path.join(f.temp, "bin/bun")
      const source = fs.readFileSync(bun, "utf8")
      fs.writeFileSync(bun, source.replace('if (dir.endsWith("/.smithers"))', 
        "if (dir.endsWith(" + JSON.stringify("/" + dir) + ")) process.exit(" + status + ")\n" +
        'if (dir.endsWith("/.smithers"))'))
      assert.throws(() => f.run(), error => {
        const prefix = "CI fixture failed: "
        assert.ok(error.message.startsWith(prefix), "failure must name the failed CI fixture and preserve process context")
        const context = JSON.parse(error.message.split("\n")[0].slice(prefix.length))
        assert.equal(context.status, status)
        assert.equal(context.signal, null)
        assert.equal(context.errorCode, null)
        assert.deepEqual(context.startedInstallers, directories.slice(0, directories.indexOf(dir) + 1))
        assert.ok(Number.isFinite(context.elapsedMilliseconds) && context.elapsedMilliseconds >= 0)
        return true
      })
    })
  }
}

test("CI fixture reports a bounded child timeout with process context", t => {
  const f = fixture(t)
  assert.throws(() => f.run(1), error => {
    const prefix = "CI fixture failed: "
    assert.ok(error.message.startsWith(prefix), "timeout must preserve process context")
    const context = JSON.parse(error.message.split("\n")[0].slice(prefix.length))
    assert.equal(context.status, null)
    assert.equal(context.signal, "SIGTERM")
    assert.equal(context.errorCode, "ETIMEDOUT")
    assert.deepEqual(context.startedInstallers, directories.slice(0, context.startedInstallers.length))
    assert.ok(Number.isFinite(context.elapsedMilliseconds) && context.elapsedMilliseconds >= 0)
    assert.equal(typeof context.stdout, "string")
    assert.equal(typeof context.stderr, "string")
    return true
  })
})

for (const args of [["--prepare-only", "//fixture"], ["--prepare-only", "--jobs", "8"]]) {
  test("prerequisite-only mode rejects graph arguments before changing installs: " + args.join(" "), t => {
    const f = fixture(t)
    const result = spawnSync("sh", ["scripts/ci.sh", ...args], {
      cwd: f.root, encoding: "utf8", timeout: 30_000,
      env: { ...process.env, PATH: path.join(f.temp, "bin") + ":" + process.env.PATH,
        INSTALL_LOG: path.join(f.temp, "unexpected-installs"), CI_LOG: path.join(f.temp, "unexpected-graph") }
    })
    assert.equal(result.status, 2, result.stdout + result.stderr)
    assert.match(result.stderr, /--prepare-only/)
    assert.equal(fs.existsSync(path.join(f.temp, "unexpected-installs")), false)
    assert.equal(fs.existsSync(path.join(f.temp, "unexpected-graph")), false)
  })
}


test("prerequisite-only mode leaves every provisioned shared install untouched", t => {
  const f = fixture(t)
  for (const dir of directories) {
    const modules = path.join(f.root, dir, "node_modules")
    const shared = path.join(f.temp, "shared", dir, "node_modules")
    fs.mkdirSync(path.dirname(shared), { recursive: true })
    fs.renameSync(modules, shared)
    fs.symlinkSync(shared, modules, "dir")
  }
  assert.deepEqual(f.run(30000, true), [])
  for (const dir of directories) assert.ok(fs.lstatSync(path.join(f.root, dir, "node_modules")).isSymbolicLink())
})


test("prerequisite-only mode installs both stock pins and reuses their prepared caches", t => {
  const f = fixture(t)
  const cache = path.join(f.root, "packages/ts-mapper/test/.cache")
  fs.rmSync(cache, { recursive: true })
  const log = path.join(f.temp, "stock-installs.jsonl")
  const npm = path.join(f.temp, "bin/npm")
  fs.writeFileSync(npm, `#!${process.execPath}
const fs = require("node:fs")
const path = require("node:path")
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n")
const target = path.join(args[args.indexOf("--prefix") + 1], "node_modules/.bin/tsc")
fs.mkdirSync(path.dirname(target), { recursive: true })
fs.writeFileSync(target, "#!/bin/sh\\nexit 0\\n", { mode: 0o755 })
`, { mode: 0o755 })
  f.run(30000, true)
  f.run(30000, true)
  const calls = fs.readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line))
  assert.deepEqual(calls, ["7.1.0-beta", "7.0.2"].map(version =>
    ["install", "--prefix", "packages/ts-mapper/test/.cache/typescript-" + version,
      "--no-audit", "--no-fund", "--silent", "typescript@" + version]))
})
