import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"

// scripts/warm-go-cache.sh compiles what the graph's Go targets compile into the shared Go cache.
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8")
const graphCache = "$HOME/.cache/go-build-smthrs"

const warmed = () => {
  const run = spawnSync("sh", [new URL("warm-go-cache.sh", import.meta.url).pathname, "--print"], { encoding: "utf8" })
  assert.equal(run.status, 0, run.stderr)
  return run.stdout.split("\n").filter(Boolean)
}

// A Go package pattern covers another as `go list` does: itself, or everything under a `/...` prefix.
const covers = (pattern, pkg) => {
  const trim = p => p.replace(/\/$/, "")
  if (!pattern.endsWith("/...")) return trim(pattern) === trim(pkg)
  const base = pattern.slice(0, -4)
  return trim(pkg.replace(/\/\.\.\.$/, "")) === base || pkg.startsWith(base + "/")
}

test("the warm script compiles every Go package a graph target or the forms check compiles", () => {
  const sources = ["PACKAGE.ts", "typescript/PACKAGE.ts", "typescript/tsc/PACKAGE.ts", "scripts/check-forms-table.sh"]
  const named = [...new Set(sources.flatMap(s => read(s).match(/\.\/(?:internal|cmd)\/[\w./-]*/g) ?? []))]
  assert.ok(named.length >= 8, named.join(" "))
  const patterns = warmed()
  assert.deepEqual(named.filter(pkg => !patterns.some(p => covers(p, pkg))), [])
})

test("a package pattern covers only itself and what it names below it", () => {
  assert.ok(covers("./internal/checker/...", "./internal/checker/"))
  assert.ok(covers("./internal/checker/...", "./internal/checker/sub/..."))
  assert.ok(!covers("./internal/checker/...", "./internal/checkerx/"))
  assert.ok(!covers("./internal/vibelang/", "./internal/vibelang/sub"))
})

test("the forms check compiles into the Go cache the other Go targets fill", () => {
  assert.ok(read("PACKAGE.ts").includes(`GOCACHE=${graphCache} bash scripts/check-forms-table.sh`))
  assert.ok(read("typescript/PACKAGE.ts").includes(`GOCACHE=${graphCache} `))
  assert.ok(read("scripts/warm-go-cache.sh").includes(`GOCACHE:-${graphCache}`))
})

test("merge-queue GitHub Actions workflows are retired in favor of smthrs ci (#469)", () => {
  assert.equal(existsSync(new URL("../.github/workflows/mq-pregate.yml", import.meta.url)), false)
  assert.equal(existsSync(new URL("../.github/workflows/go-cache.yml", import.meta.url)), false)
})

// Copy sources without repository metadata or installs. Warmup must work with
// the POSIX tools in the Go-only workflow, including when Node is unavailable.
function warmFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "go-cache-inventory-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (path, source) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), source)
  }
  for (const path of ["scripts/warm-go-cache.sh", "PACKAGE.ts", "typescript/PACKAGE.ts", "typescript/tsc/PACKAGE.ts", "scripts/check-forms-table.sh"]) {
    put(path, read(path))
  }
  const inventory = "scripts/go-cache-packages.awk"
  try { put(inventory, read(inventory)) } catch (error) { if (error.code !== "ENOENT") throw error }
  const run = () => spawnSync("sh", [join(root, "scripts/warm-go-cache.sh"), "--print"], {
    encoding: "utf8", timeout: 10_000
  })
  return { root, put, run }
}

test("new declared Go packages enter warmup without maintaining another list", t => {
  const { put, run } = warmFixture(t)
  const source = read("typescript/tsc/PACKAGE.ts")
  for (let index = 0; index < 32; index++) {
    const pattern = "./internal/cacheFixture" + index + (index % 2 ? "/..." : "/")
    put("typescript/tsc/PACKAGE.ts", source + '\nconst added = goTest("new regression", "' + pattern + '", "internal/cacheFixture' + index + '")\n')
    const result = run()
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr)
    const patterns = result.stdout.trim().split("\n")
    assert.ok(patterns.some(p => covers(p, pattern)), "warmup misses " + pattern)
    assert.equal(patterns.some(p => covers(p, "./internal/cacheFixture" + index + "Sibling")), false)
    if (!pattern.endsWith("/...")) assert.equal(patterns.some(p => covers(p, pattern + "nested")), false)
  }
})

test("warmup inventory is unique and deterministic", () => {
  const patterns = warmed()
  assert.deepEqual(patterns, [...new Set(patterns)].sort())
})

test("unreadable or empty declaration inventories fail before warming any package", t => {
  const { root, put, run } = warmFixture(t)
  rmSync(join(root, "typescript/tsc/PACKAGE.ts"))
  assert.notEqual(run().status, 0, "missing declarations must not silently narrow warmup")
  for (const path of ["PACKAGE.ts", "typescript/PACKAGE.ts", "typescript/tsc/PACKAGE.ts", "scripts/check-forms-table.sh"]) put(path, "")
  const empty = run()
  assert.notEqual(empty.status, 0, "an empty inventory must not mean go test in the current directory")
  assert.match(empty.stderr, /inventory|package/i)
})

test("dynamic package suffixes refuse a partial inventory", t => {
  const { put, run } = warmFixture(t)
  for (const suffix of ["$" + "{part}", "*", "?", "[ab]", "+extra", "{a,b}"]) {
    put("typescript/tsc/PACKAGE.ts", read("typescript/tsc/PACKAGE.ts") +
      '\nconst dynamic = "./internal/cacheFixture' + suffix + '"\n')
    const result = run()
    assert.notEqual(result.status, 0, suffix)
    assert.match(result.stderr, /dynamic package selector/, suffix)
  }
})
