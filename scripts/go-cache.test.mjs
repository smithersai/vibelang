import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
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

// Until go-cache.yml first saves, and whenever GitHub evicts every go- cache, the day's cache is the only Go build a
// hosted gate starts from; without it a gate compiles the module cold and //:spec-tests times out.
test("the day's pre-gate cache still holds the Go build, restored under the go- cache", () => {
  const gate = read(".github/workflows/mq-pregate.yml")
  const paths = gate.match(/CACHE_PATHS: \|\n((?:\s+~\S+\n)+)/)[1].split("\n").map(l => l.trim())
  assert.ok(paths.includes("~/.cache/go-build-smthrs"), paths.join(" "))
  const day = gate.indexOf("key: gate-${{ steps.day.outputs.day }}")
  const [go] = goSteps(gate, "restore")
  assert.ok(day > 0 && go > 0, "both restore steps")
  assert.ok(go > day, "the go- restore runs after the day's restore, so its newer entries are the ones kept")
})
