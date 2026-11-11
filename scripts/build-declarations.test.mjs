import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

test("the real build graph loads the documentation table checks", () => {
  const root = fileURLToPath(new URL("../", import.meta.url))
  const cli = fileURLToPath(new URL("../.smithers/node_modules/.bin/smthrs", import.meta.url))
  const run = spawnSync(cli, ["graph", "//:docs-table-rows", "--workspace", root, "--format", "json"], {
    cwd: root, encoding: "utf8", timeout: 60000
  })
  assert.ifError(run.error)
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const graph = JSON.parse(run.stdout)
  assert.deepEqual(graph.roots, ["//:docs-table-rows"])
  const target = graph.targets.find(target => target.label === "//:docs-table-rows")
  assert.equal(target?.target, "Shell.Test")
  assert.deepEqual(target.kinds, ["test"])
  assert.ok(graph.edges.some(edge =>
    edge.from === "//:docs-table-rows" && edge.to === "//:tree" && edge.kind === "data"))
})

test("release includes command contracts as a shared graph prerequisite", () => {
  const root = fileURLToPath(new URL("../", import.meta.url))
  const cli = fileURLToPath(new URL("../.smithers/node_modules/.bin/smthrs", import.meta.url))
  const run = spawnSync(cli, ["graph", "//:release", "--workspace", root, "--format", "json"], {
    cwd: root, encoding: "utf8", timeout: 60000
  })
  assert.ifError(run.error)
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const graph = JSON.parse(run.stdout)
  assert.ok(graph.edges.some(edge =>
    edge.from === "//:release" && edge.to === "//:build-contracts" && edge.kind === "data"),
    "a focused release must retain the command audits without executing their suites again")
})

test("the compatible Go suite expands to independent shard actions in the real SDK", () => {
  const root = fileURLToPath(new URL("../", import.meta.url))
  const cli = fileURLToPath(new URL("../.smithers/node_modules/.bin/smthrs", import.meta.url))
  const run = spawnSync(cli, ["graph", "//:go-vibelang", "--workspace", root, "--format", "json"], {
    cwd: root, encoding: "utf8", timeout: 60000
  })
  assert.ifError(run.error)
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const graph = JSON.parse(run.stdout)
  assert.deepEqual(graph.roots, ["//:go-vibelang"])
  assert.equal(graph.targets.find(target => target.label === "//:go-vibelang")?.target, "Suite")
  const shardRun = spawnSync(cli, ["graph", "//...", "--workspace", root, "--format", "json"], {
    cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024
  })
  assert.ifError(shardRun.error)
  assert.equal(shardRun.status, 0, shardRun.stdout + shardRun.stderr)
  const shardGraph = JSON.parse(shardRun.stdout)
  const shards = shardGraph.targets.filter(target => /^\/\/:go-vibelang-shard-\d+$/.test(target.label))
  assert.ok(shards.length > 1)
  assert.ok(shards.every(target => target.target === "Shell.Test"))
  assert.deepEqual(graph.edges.filter(edge => edge.from === "//:go-vibelang")
    .map(edge => edge.to).sort(), shards.map(target => target.label).sort())
  for (const shard of shards) {
    assert.ok(!shardGraph.edges.some(edge => edge.from === shard.label && shards.some(peer => peer.label === edge.to)),
      shard.label + ": no sibling dependency may serialize the shards")
    assert.ok(shardGraph.edges.some(edge => edge.from === shard.label && edge.to === "//:tree"))
    assert.ok(shardGraph.edges.some(edge => edge.from === shard.label && edge.to === "//typescript/tsc:vibelang-files"))
    assert.ok(shardGraph.edges.some(edge => edge.from === shard.label && edge.to === "//:go-vibelang-compile-1"))
  }
})

test("smthrs ci executes every member when selecting a Suite label", t => {
  const root = fileURLToPath(new URL("../", import.meta.url))
  const cli = join(root, ".smithers/node_modules/.bin/smthrs")
  const workspace = mkdtempSync(join(tmpdir(), "go-suite-compatibility-"))
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  mkdirSync(join(workspace, ".smithers"))
  symlinkSync(join(root, ".smithers/node_modules"), join(workspace, ".smithers/node_modules"), "dir")
  writeFileSync(join(workspace, ".smithers/package.json"), JSON.stringify({ private: true, type: "module" }))
  writeFileSync(join(workspace, ".smithers/WORKSPACE.ts"), `
import { Smithers as S } from "@smthrs/targets"
const runtime = S.Runtime.Node({ version: ">=26.4.0" })
export const Workspace = S.Workspace("suite-compatibility", {
  repository: "https://example.test/suite-compatibility",
  runtime,
  packageManager: S.PackageManager.Pnpm({ version: "11.25.0", runtime }),
  nodeModules: S.Npm.NodeModules({ packageJson: S.file("//.smithers/package.json") }),
  cache: S.Cache({ directory: ".cache" }),
  host: S.Host({ bins: ["sh", "chmod"] })
})
`)
  const binaryShell = "printf '%s\\n' '#!/bin/sh' 'echo $1 > $1.receipt' > shared-test; chmod +x shared-test; echo compiled >> compile.receipt"
  writeFileSync(join(workspace, "PACKAGE.ts"), `
import { Smithers as S } from "@smthrs/targets"
const binary = S.Shell.Build({
  shell: ${JSON.stringify(binaryShell)},
  tools: [S.Host.bin("sh"), S.Host.bin("chmod")], outFiles: ["shared-test"],
  sandbox: "none", timeout: "1m"
})
const shards = Object.fromEntries(["first", "second"].map(name => [name, S.Shell.Test({
  shell: "./shared-test " + name,
  data: [binary], tools: [S.Host.bin("sh")], sandbox: "none", timeout: "1m"
})]))
export const Package = S.Package({
  targets: { compile: binary, ...shards, compatible: S.Suite({ tests: Object.values(shards) }) }
})
`)
  const run = spawnSync(cli, ["ci", "//:compatible", "--workspace", workspace, "--jobs", "2", "--format", "json"], {
    cwd: workspace, encoding: "utf8", timeout: 60000
  })
  assert.ifError(run.error)
  assert.equal(run.status, 0, run.stdout + run.stderr)
  assert.equal(readFileSync(join(workspace, "compile.receipt"), "utf8").trim(), "compiled")
  for (const name of ["first", "second"]) {
    assert.equal(readFileSync(join(workspace, name + ".receipt"), "utf8").trim(), name)
  }
})

test("the real full fuzz suite reaches every independent seed and package target", () => {
  const root = fileURLToPath(new URL("../", import.meta.url))
  const cli = fileURLToPath(new URL("../.smithers/node_modules/.bin/smthrs", import.meta.url))
  const run = spawnSync(cli, ["graph", "//:go-vibelangfuzz", "--workspace", root, "--format", "json"], {
    cwd: root, encoding: "utf8", timeout: 60000
  })
  assert.ifError(run.error)
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const graph = JSON.parse(run.stdout)
  const group = graph.targets.find(target => target.label === "//:go-vibelangfuzz")
  assert.equal(group?.target, "Suite")
  const dependencies = graph.edges.filter(edge => edge.from === group.label).map(edge => edge.to)
  const expected = [
    "//:go-vibelangfuzz-vip",
    ...Array.from({ length: 32 }, (_, i) => "//:go-vibelangfuzz-seeds-" + (i + 1)),
    ...["grammaradmission", "specgen", "vipgen", "testtools-parse", "vipgen-programs"]
      .map(pkg => "//:go-vibelangfuzz-package-" + pkg)
  ]
  assert.deepEqual(dependencies.sort(), expected.sort())
  assert.equal(new Set(dependencies).size, expected.length)

})
