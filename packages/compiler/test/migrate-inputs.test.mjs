import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { packageDeclarations } from "../../../scripts/testing/package-declarations.mjs"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const flows = [".smithers/flows/migrate", ".smithers/flows/convert"]
// Every file of the migrate and convert flows: the targets below run their tests and import their library, templates
// and corpus. A list of chosen files went stale as lanes added tests (and 10 rejections in 12 hours on 2026-11-01 were
// lanes editing that list); a `//` glob in packages/PACKAGE.ts matched no file at all.
const flowFiles = dir => readdirSync(join(root, dir), { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? (e.name === "node_modules" ? [] : flowFiles(dir + "/" + e.name)) : [dir + "/" + e.name])

// The targets that run or import the flows, by their packages/PACKAGE.ts names.
// The compiler package tests run as four file shards, compiler-test-1 to compiler-test-4.
const consumers = ["compiler-test-1", "compiler-test-2", "compiler-test-3", "compiler-test-4", "migrate-test", "vite-test", "compiler-tools-test"]

// Evaluate the actual constructors without planning the workspace. Every leaf
// below a compatibility Suite must retain the flow inputs, not just the group.
function consumerLeaves(source, label) {
  const targets = packageDeclarations(source)
  const target = targets[label]
  assert.ok(target, "packages/PACKAGE.ts: no target " + label)
  const leaves = node => node.kind === "Suite" ? node.tests.flatMap(leaves) : node.kind === "Shell.Test" ? [node] : []
  const selected = leaves(target)
  assert.ok(selected.length, "no executable flow consumers under " + label)
  return selected
}
const hasFlowInputs = target => target.data.some(input => input.kind === "migrationSources")

test("each flow consumer takes //:migration-sources", () => {
  const source = readFileSync(join(root, "packages/PACKAGE.ts"), "utf8")
  for (const label of consumers) {
    for (const leaf of consumerLeaves(source, label)) {
      assert.ok(hasFlowInputs(leaf), "//packages:" + label + " must retain migrationSources on every leaf")
    }
  }
})

test("the declaration reader sees a target or Suite leaf that drops //:migration-sources", () => {
  const source = readFileSync(join(root, "packages/PACKAGE.ts"), "utf8")
  for (const [builder, label] of [["migrateTest", "migrate-test"], ["pluginTest", "vite-test"], ["compilerTest", "compiler-test-1"]]) {
    const dropped = source.replace(new RegExp("(const " + builder + " = [\\s\\S]*?)migrationSources,"), "$1")
    assert.notEqual(dropped, source)
    assert.ok(consumerLeaves(dropped, label).some(leaf => !hasFlowInputs(leaf)))
    for (const leaf of consumerLeaves(source, label)) assert.ok(hasFlowInputs(leaf))
  }
})

test("//:migration-sources keys every file of the migrate and convert flows, including hidden directories", { timeout: 180000 }, () => {
  const child = spawnSync(process.execPath, [join(root, ".smithers/node_modules/.bin/smthrs"), "explain", "//:migration-sources", "--format", "json", "--verbose"],
    { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 150000 })
  assert.equal(child.status, 0, child.stderr || child.stdout)
  const files = new Map(JSON.parse(child.stdout).inputs.flatMap(input => input.files ?? []).map(f => [f.path, f.digest]))
  const required = flows.flatMap(flowFiles)
  assert.ok(required.some(f => f.startsWith(flows[0] + "/templates/")) && required.some(f => f.startsWith(flows[0] + "/test/corpus/")))
  for (const file of required) {
    assert.ok(files.has(file), "//:migration-sources: missing cache input " + file)
    assert.equal(files.get(file), createHash("sha256").update(readFileSync(join(root, file))).digest("hex"), "//:migration-sources: stale digest for " + file)
  }
})
