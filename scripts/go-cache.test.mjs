import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"

// .github/workflows/go-cache.yml compiles, on each push to main, what the graph's Go targets compile and saves the
// Go cache; mq-pregate.yml restores it so a hosted gate compiles only what its change touched. A daily cache made
// the hosted compiler build go from 41 s to 393 s over a day of pushes (2026-10-31).
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

// actions/cache keys a cache's version on its paths: a restore that lists other paths never finds the save.
const goSteps = (yml, step) =>
  [...yml.matchAll(new RegExp(`uses: actions/cache/${step}@\\w+\\n\\s+with:\\n\\s+path: (\\S+)\\n\\s+key: go-`, "g"))].map(m => m.index)

test("the hosted pre-gate restores the Go cache go-cache.yml saves, with the same path", () => {
  const warm = read(".github/workflows/go-cache.yml"), gate = read(".github/workflows/mq-pregate.yml")
  const path = (yml, step) => yml.match(new RegExp(`uses: actions/cache/${step}@\\w+\\n\\s+with:\\n\\s+path: (\\S+)\\n\\s+key: go-`))?.[1]
  assert.equal(path(warm, "save"), "~/.cache/go-build-smthrs")
  assert.equal(path(warm, "restore"), path(warm, "save"))
  assert.equal(path(gate, "restore"), path(warm, "save"))
})

// The day's cache restores yesterday's and saves it again, so a Go build in it only grows; 17 hosted runs in a day
// died with "No space left on device" while restoring it (2026-10-31/11-01). The go- cache, trimmed on each push,
// is the one source of the graph's Go build.
const gate = () => read(".github/workflows/mq-pregate.yml")

test("the day's pre-gate cache leaves the graph's Go build to the go- cache", () => {
  const paths = gate().match(/CACHE_PATHS: \|\n((?:\s+~\S+\n)+)/)[1].split("\n").map(l => l.trim()).filter(Boolean)
  assert.ok(paths.length >= 3, paths.join(" "))
  assert.ok(!paths.includes(graphCache.replace("$HOME", "~")), paths.join(" "))
  assert.equal(goSteps(gate(), "restore").length, 1, "one go- restore")
})

test("the hosted pre-gate frees disk space before it restores a cache", () => {
  const yml = gate()
  const free = yml.indexOf("- name: Free disk space")
  const firstRestore = yml.indexOf("uses: actions/cache/restore@")
  assert.ok(free > 0 && firstRestore > 0, "both steps")
  assert.ok(free < firstRestore, "space is freed first")
  assert.match(yml.slice(free, firstRestore), /sudo rm -rf \/usr\/share\/dotnet /)
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
