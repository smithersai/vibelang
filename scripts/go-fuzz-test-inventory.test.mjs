import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { declarationTargets } from "./testing/package-declaration.mjs"

const root = new URL("../", import.meta.url)
const graph = declarationTargets("PACKAGE.ts")
const shards = Object.entries(graph).filter(([label]) => /^go-vibelangfuzz-(seeds-\d+|package-|vip$)/.test(label))
const packageOf = target => target.shell.match(/ (\.\/internal\/vibelangfuzz(?:\/[a-z]+)*\/)$/)?.[1]
const read = path => readFileSync(new URL(path, root), "utf8")

function inventory() {
  const packages = new Map()
  function walk(dir) {
    const entries = readdirSync(new URL(dir + "/", root), { withFileTypes: true })
    const files = entries.filter(entry => entry.isFile() && entry.name.endsWith(".go"))
    if (files.length) {
      const tests = files.filter(entry => entry.name.endsWith("_test.go")).flatMap(entry => {
        const file = dir + "/" + entry.name
        return [...read(file).matchAll(/^func\s+((?:Test|Fuzz|Example)[\p{L}\p{N}_]*)\s*\(/gmu)]
          .filter(match => match[1] !== "TestMain")
          .map(match => ({ name: match[1], file }))
      })
      packages.set("./" + dir.replace("typescript/tsc/", "") + "/", tests)
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== "testdata" && !entry.name.startsWith("."))
        walk(dir + "/" + entry.name)
    }
  }
  walk("typescript/tsc/internal/vibelangfuzz")
  return packages
}

test("the full fuzz label groups independent bounded checks", () => {
  assert.ok(shards.length >= 16, "replace the long single check with independent graph targets")
  assert.deepEqual(new Set(graph["go-vibelangfuzz"].tests), new Set(shards.map(([, target]) => target)))
  for (const [label, target] of shards) {
    assert.equal(target.timeout, "10m", label)
    assert.match(target.shell, /go test -short -count=1 -timeout=8m -trimpath -exec /)
    assert.match(target.shell, /VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s/)
    for (const input of ["tsc.srcs", "//scripts/go-test-shards.sh"])
      assert.ok(target.data.includes(input), label + ": missing " + input)
    if (!label.includes("-package-")) {
      for (const input of [graph.tree, "tsc.vibelangfuzz-files", "packages.runtime-dist", "packages.compiler-native"])
        assert.ok(target.data.includes(input), label + ": missing " + input)
      assert.ok(target.data.some(input => input?.migrationSources === true), label)
    } else {
      assert.match(target.shell, /GOMAXPROCS=4 GOFLAGS=-p=4/, label + ": bound cold compilation")
      assert.ok(!target.data.includes(graph.tree), label + ": retain package-scoped inputs")
      const patterns = target.data.flatMap(input => input?.srcs ?? [])
      assert.ok(patterns.includes("typescript/tsc/" + packageOf(target).slice(2) + "**"), label)
      assert.ok(patterns.includes("typescript/tsc/internal/vibelangfuzz/testdata/**"), label)
      if (label.endsWith("-grammaradmission")) assert.ok(patterns.includes("docs/design/**"), label)
    }
    assert.match(target.env.GO_TEST_SLICE, /^\d+\/\d+$/)
    assert.equal(target.env.GO_TEST_SHARDS, "2")
  }
})

test("every fuzz package and test file belongs to one complete disjoint shard set", () => {
  const packages = inventory()
  assert.ok(packages.size >= 4)
  assert.deepEqual(new Set(shards.map(([, target]) => packageOf(target))), new Set(packages.keys()))
  for (const [pkg, tests] of packages) {
    const selected = shards.filter(([, target]) => packageOf(target) === pkg && !target.shell.includes(" -run "))
    const slices = selected.map(([, target]) => target.env.GO_TEST_SLICE)
    const total = selected.length
    assert.deepEqual(slices.sort(), Array.from({ length: total }, (_, i) => (i + 1) + "/" + total).sort(), pkg)
    assert.equal(new Set(tests.map(test => test.name)).size, tests.length, pkg + ": duplicate test declaration")
  }
})

test("the actual launcher assigns every current and newly added fuzz name exactly once", t => {
  const dir = mkdtempSync(join(tmpdir(), "fuzz-target-inventory-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const bin = join(dir, "fixture.mjs"), namesFile = join(dir, "names.json")
  const assigned = join(dir, "assigned")
  writeFileSync(bin, "#!" + process.execPath + "\n" + [
    'import { readFileSync, appendFileSync } from "node:fs"',
    'const names = JSON.parse(readFileSync(process.env.FUZZ_INVENTORY_NAMES, "utf8"))',
    'if (process.argv.includes("-test.list")) console.log(names.join("\\n"))',
    'else {',
    '  const pattern = process.argv.find(arg => arg.startsWith("-test.run="))?.slice(10)',
    '  if (!pattern) throw new Error("missing shard selector")',
    '  const skip = process.argv.find(arg => arg.startsWith("-test.skip="))?.slice(11)',
    '  const selected = names.filter(name => new RegExp(pattern).test(name) && (!skip || !new RegExp(skip).test(name)))',
    '  appendFileSync(process.env.FUZZ_INVENTORY_ASSIGNED, selected.join("\\n") + "\\n")',
    '  process.exit(selected.includes("TestSpecCitedProductionsExist") ? 19 : 0)',
    '}'
  ].join("\n"), { mode: 0o700 })
  let allTests = 0
  for (const [pkg, tests] of inventory()) {
    const targets = shards.filter(([, target]) => packageOf(target) === pkg)
    assert.ok(targets.length, pkg + ": unassigned package")
    // New names and Unicode identifiers must be assigned without editing a list.
    const names = [...tests.map(test => test.name), "TestNewInventoryNeighbour", "FuzzNewInventoryNeighbour", "TestÉtoile", "FuzzVIPDifferentialNeighbour"]
    writeFileSync(namesFile, JSON.stringify(names))
    writeFileSync(assigned, "")
    mkdirSync(join(dir, "testdata"), { recursive: true })
    const weights = pkg + "testdata/shard-seconds.txt"
    try { copyFileSync(new URL("typescript/tsc/" + weights.slice(2), root), join(dir, "testdata/shard-seconds.txt")) }
    catch (error) { if (error.code !== "ENOENT") throw error; writeFileSync(join(dir, "testdata/shard-seconds.txt"), "") }
    let failing = 0
    for (const [label, target] of targets) {
      const selectors = ["run", "skip"].flatMap(flag => {
        const pattern = target.shell.match(new RegExp(" -" + flag + " '([^']+)'"))?.[1]
        return pattern ? ["-test." + flag + "=" + pattern] : []
      })
      const run = spawnSync("sh", [new URL("scripts/go-test-shards.sh", root).pathname, bin, "-test.short=true", ...selectors], {
        cwd: dir, encoding: "utf8", timeout: 15000,
        env: { ...process.env, ...target.env, GO_TEST_CORES: "4",
          FUZZ_INVENTORY_NAMES: namesFile, FUZZ_INVENTORY_ASSIGNED: assigned }
      })
      assert.ifError(run.error)
      assert.ok([0, 19].includes(run.status), label + ": " + run.stdout + run.stderr)
      if (run.status === 19) failing++
    }
    assert.equal(failing, names.includes("TestSpecCitedProductionsExist") ? 1 : 0,
      "an existing failing name must fail exactly one target")
    assert.deepEqual(readFileSync(assigned, "utf8").split("\n").filter(Boolean).sort(), [...names].sort(), pkg)
    allTests += tests.length
  }
  assert.ok(allTests > 2000, "retain the complete corpus inventory: " + allTests)
})

test("all already fast fuzz siblings and specification checks have ten minute graph limits", () => {
  for (const label of ["go-vibelangfuzz-editor", "go-vibelangfuzz-compile",
    "go-vibelangfuzz-config", "go-vibelangfuzz-hangs", "spec-tests"]) {
    assert.equal(graph[label].timeout, "10m", label)
  }
  // The pending gate runs as parallel groups, each with the same limit.
  const pending = graph["go-vibelangfuzz-pending"].tests
  assert.ok(pending.length > 1)
  for (const group of pending) assert.equal(group.timeout, "10m")
})

test("the differential oracle has exactly one dedicated selection", () => {
  const vip = graph["go-vibelangfuzz-vip"]
  assert.ok(vip)
  assert.match(vip.shell, / -run '\^FuzzVIPDifferential\$'/)
  assert.doesNotMatch(vip.shell, / -skip /)
  for (const [label, target] of shards.filter(([label]) => label.includes("-seeds-"))) {
    assert.match(target.shell, / -skip '\^FuzzVIPDifferential\$'/, label)
    assert.doesNotMatch(target.shell, / -run /, label)
  }
})
