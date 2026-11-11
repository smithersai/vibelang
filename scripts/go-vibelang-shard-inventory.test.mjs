import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { declarationFixture } from "./testing/package-declaration.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const suite = () => declarationFixture("PACKAGE.ts").targets
const shards = graph => Object.entries(graph).filter(([name]) => /^go-vibelang-shard-\d+$/.test(name))

function inventory() {
  const packages = new Map()
  function walk(dir) {
    const files = readdirSync(join(root, dir), { withFileTypes: true })
    for (const file of files) {
      if (file.isDirectory() && file.name !== "testdata") walk(dir + "/" + file.name)
      if (!file.isFile() || !file.name.endsWith(".go")) continue
      const entry = packages.get(dir) ?? { files: [], names: [] }
      packages.set(dir, entry)
      if (!file.name.endsWith("_test.go")) continue
      const source = readFileSync(join(root, dir, file.name), "utf8")
      const names = [...source.matchAll(/^func\s+((?:Test|Fuzz|Example)[^\s(]*)\s*\(/gm)]
        .map(([, name]) => name).filter(name => /^(Test|Fuzz|Example)(?:[^a-z]|$)/.test(name))
      entry.files.push(file.name)
      entry.names.push(...names)
      packages.set(dir, entry)
    }
  }
  walk("typescript/tsc/internal/vibelang")
  return packages
}

test("the old Go label groups every independent bounded shard exactly once", () => {
  const graph = suite(), selected = shards(graph)
  assert.ok(selected.length >= 2, "the old monolithic check must become independent targets")
  const members = graph["go-vibelang"].tests
  assert.deepEqual(Array.from(members), selected.map(([, target]) => target))
  assert.equal(new Set(members).size, selected.length)
  const slices = selected.map(([, target]) => target.env.GO_TEST_SLICE)
  assert.deepEqual(slices, selected.map((_, i) => (i + 1) + "/" + selected.length))
  for (const [name, target] of selected) {
    assert.equal(target.timeout, "10m", name)
    assert.equal(target.env.GO_TEST_SHARDS, "1", name + ": one Go process per worker")
    assert.equal(target.env.GOMAXPROCS, "4", name + ": use the four worker CPUs")
    assert.match(target.shell, /scripts\/go-test-shards\.sh"/)
    assert.match(target.shell, /-test\.v -test\.paniconexit0 -test\.count=1 -test\.timeout=8m/)
    assert.match(target.shell, /TYPESCRIPT_REPO_ROOT=\$PWD/)
    assert.ok(target.data.includes(graph["go-vibelang-compile-1"]), name + ": consume the shared executable")
    assert.doesNotMatch(target.shell, /-short|-skip|-run|-failfast|-vet=off/)
    for (const input of ["tsc.srcs", "tsc.vibelang-files", "packages.runtime-dist", "//scripts/go-test-shards.sh"]) {
      assert.ok(target.data.includes(input), name + ": missing " + input)
    }
    assert.ok(target.data.some(input => input === graph.tree), name + ": retain repository fixtures")
    assert.ok(!target.data.some(input => selected.some(([, peer]) => input === peer)), name + ": shards must run independently")
  }
})

test("shared binaries compile every package with the original inputs and default vet checks", () => {
  const graph = suite()
  const builds = Object.entries(graph).filter(([name]) => /^go-vibelang-compile-\d+$/.test(name))
  const packages = Array.from(declarationFixture("PACKAGE.ts").evaluate("goVibelangPackages"))
  assert.deepEqual([...inventory().keys()].sort(), packages.map(pkg => "typescript/tsc/" + pkg).sort())
  assert.equal(builds.length, packages.length)
  builds.forEach(([label, target], index) => {
    assert.match(target.shell, /go test -c -count=1 -p 8 -trimpath -o /)
    assert.ok(target.shell.endsWith("./" + packages[index]), label)
    assert.doesNotMatch(target.shell, /-vet|-skip|-run|-short/)
    assert.equal(target.timeout, "10m")
    assert.equal(target.env.GOMAXPROCS, "4", label + ": use the worker's four CPUs")
    assert.equal(target.outFiles.length, 1)
    assert.ok(target.data.includes(graph.tree))
    for (const input of ["tsc.srcs", "tsc.vibelang-files", "packages.runtime-dist"]) {
      assert.ok(target.data.includes(input), label + ": missing " + input)
    }
  })
})

test("real shard commands cover every package and name once and retain exactly one failure", t => {
  const fixture = declarationFixture("PACKAGE.ts")
  const selected = shards(fixture.targets)
  assert.ok(selected.length >= 2, "no Go shards declared")
  const packages = inventory()
  const binaries = Array.from(fixture.evaluate("goVibelangBinaries"))
  const dir = mkdtempSync(join(tmpdir(), "go-vibelang-inventory-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, "scripts"))
  writeFileSync(join(dir, "scripts/go-test-shards.sh"),
    readFileSync(join(root, "scripts/go-test-shards.sh")), { mode: 0o700 })
  const expected = [], counts = new Map()
  for (const { pkg, output } of binaries) {
    const { files, names } = packages.get("typescript/tsc/" + pkg)
    assert.ok(names.length > 0, pkg + ": no discoverable names in " + files)
    assert.equal(new Set(names).size, names.length, pkg + ": duplicate test name")
    expected.push(...names.map(name => pkg + ":" + name))
    const cwd = join(dir, "typescript/tsc", pkg)
    mkdirSync(join(cwd, "testdata"), { recursive: true })
    let weights = ""
    try { weights = readFileSync(join(root, "typescript/tsc", pkg, "testdata/shard-seconds.txt"), "utf8") } catch (e) {
      if (e.code !== "ENOENT") throw e
    }
    writeFileSync(join(cwd, "testdata/shard-seconds.txt"), weights)
    const binary = join(dir, output)
    mkdirSync(join(binary, ".."), { recursive: true })
    writeFileSync(binary, '#!' + process.execPath + '\n' + `
const fs = require("node:fs")
const names = ${JSON.stringify(names)}
const pkg = ${JSON.stringify(pkg)}
if (process.cwd() !== ${JSON.stringify(cwd)}) process.exit(12)
for (const flag of ["-test.v", "-test.paniconexit0", "-test.count=1", "-test.timeout=8m"]) {
  if (!process.argv.includes(flag)) process.exit(13)
}
if (process.argv.includes("-test.list")) {
  console.log(names.join("\\n"))
} else {
  const selector = process.argv.find(arg => arg.startsWith("-test.run="))
  if (!selector) process.exit(11)
  const selected = names.filter(name => new RegExp(selector.slice(10)).test(name))
  fs.appendFileSync(process.env.INVENTORY_OUTPUT, selected.map(name => JSON.stringify(pkg + ":" + name) + "\\n").join(""))
  if (selected.some(name => pkg + ":" + name === process.env.INVENTORY_FAIL_NAME)) process.exit(7)
}
`, { mode: 0o700 })
  }
  const output = join(dir, "ran.jsonl")
  writeFileSync(output, "")
  const witness = expected[0]
  let failures = 0
  for (const [label, target] of selected) {
    const result = spawnSync("sh", ["-c", target.shell], {
      cwd: dir, encoding: "utf8", timeout: 30000,
      env: { ...process.env, GO_TEST_CORES: "4", GO_TEST_SHARDS: "4", ...target.env,
        INVENTORY_OUTPUT: output, INVENTORY_FAIL_NAME: witness }
    })
    const ran = readFileSync(output, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line))
    const expectedStatus = ran.includes(witness) ? 7 : 0
    assert.equal(result.status, expectedStatus, label + ": " + result.stdout + result.stderr)
    if (result.status) failures++
    for (const name of ran) counts.set(name, (counts.get(name) ?? 0) + 1)
    writeFileSync(output, "")
  }
  assert.equal(failures, 1, "an existing failure must remain in exactly one shard")
  assert.deepEqual([...counts.keys()].sort(), expected.sort(), "old/new name sets differ")
  assert.deepEqual([...counts].filter(([, count]) => count !== 1), [], "duplicate test assignment")
  assert.ok(expected.length > 500, "inventory unexpectedly small: " + expected.length)
})
