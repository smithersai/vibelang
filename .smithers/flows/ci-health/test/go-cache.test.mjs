import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { ACTIONS, analyze, cause, collect, failedTests, report, start, targetLines } from "../lib/steps.mjs"

const fixture = new URL("../fixture-go-cache/", import.meta.url)
const archive = `/cache/custom-build/ab/${"ab".repeat(32)}-d`
const missing = (file = archive, module = "fmt") =>
  `vet: internal/vibelang/quoted.go:3:8: could not import ${module} (open ${file}: no such file or directory)`

test("real Go archive import failures identify cache infrastructure, not undeclared repository inputs", () => {
  const lines = targetLines(readFileSync(new URL("run-01-graph.log", fixture), "utf8"), "//:spec-tests")
  assert.equal(cause(lines), "Go cache archive")
  assert.deepEqual(failedTests(lines), [])
  assert.match(ACTIONS[cause(lines)], /cache|archive/i)
  assert.doesNotMatch(ACTIONS[cause(lines)], /declare|key ignored/i)
})

test("custom cache roots, packages and compiler source locations retain archive attribution", () => {
  let neighbours = 0
  for (const root of ["/cache", "/tmp/custom cache", "/cache/ci/.cache/go-build-smthrs", "/work/.cache"]) {
    for (const module of ["fmt", "os", "testing", "example.test/p/internal/parser"]) {
      for (const source of ["$WORK/b300/_testmain.go:7:2", "vet: internal/vibelang/quoted.go:3:8"]) {
        const hash = (neighbours++).toString(16).padStart(64, "0")
        const line = `${source}: could not import ${module} (open ${root}/${hash.slice(0, 2)}/${hash}-d: no such file or directory)`
        assert.equal(cause([line]), "Go cache archive", line)
      }
    }
  }
  assert.equal(neighbours, 32)
})

test("missing source inputs, import configuration and non-cache archives keep their existing cause", () => {
  for (const line of [
    "open fixtures/source.go: no such file or directory",
    missing("/work/library.a"),
    missing("/work/importcfg"),
    missing(archive.replace(/-d$/, "-a")),
    missing(archive.replace("ab/ab", "ab/short")),
    `open ${archive}: no such file or directory`,
    `main.go:1:1: could not import fmt (open ${archive}: permission denied)`,
    `main.go:1:1: could not import fmt (open ${archive}: invalid archive)`,
    `Cannot find module '${archive}'`,
    "ENOENT: no such file or directory, open 'input.json'"
  ]) {
    assert.notEqual(cause([line]), "Go cache archive", line)
  }
  assert.equal(cause(["open fixtures/source.go: no such file or directory"]), "missing file")
})

test("cache attribution preserves disk, memory and property counterexample precedence", () => {
  for (const [line, expected] of [
    ["write: no space left on device", "disk full"],
    ["signal: killed", "killed"],
    ["property cache failed; saved replay", "property counterexample"]
  ]) assert.equal(cause([missing(), line]), expected)
})

test("real same-key Go build failure and passing receipt reach the report without fictional test names", () => {
  const dir = mkdtempSync(join(tmpdir(), "ci-health-go-cache-"))
  try {
    start(dir, { results: fixture.pathname, since: "" })
    assert.equal(collect(dir).runs.length, 2)
    const analysis = analyze(dir)
    assert.equal(analysis.flaky.length, 1)
    const [target] = analysis.flaky
    assert.equal(target.label, "//:spec-tests")
    assert.equal(target.failures, 1)
    assert.equal(target.passes, 1)
    assert.deepEqual(target.tests, [])
    assert.deepEqual(target.causes, { "Go cache archive": 1 })
    assert.deepEqual(report(dir).tests, [])
    const text = readFileSync(join(dir, "report.md"), "utf8")
    assert.match(text, /Go cache archive 1/)
    assert.doesNotMatch(text, /Declare the input/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Go's content-addressed cache names bind the two-digit bucket to the hash.
// Reproduce each generated witness by its index; no optional test install.
test("generated cache import diagnostics retain attribution and reject malformed neighbours", () => {
  const roots = ["/cache/custom", "/tmp/custom cache", "/cache/ci/.cache/go-build", "/cache/éΩ"]
  const modules = ["fmt", "os", "testing", "example.test/mod/internal/parser"]
  for (let index = 0; index < 120; index++) {
    const hash = createHash("sha256").update("go-cache-119:" + index).digest("hex")
    const cacheRoot = roots[index % roots.length] + "/" + hash.slice(8, 16)
    const module = modules[(index >> 1) % modules.length]
    const file = cacheRoot + "/" + hash.slice(0, 2) + "/" + hash + "-d"
    const line = 1 + (index * 17) % 997, column = 1 + (index * 29) % 997
    const diagnostic = (path) => (index % 2 ? "vet: " : "") + "internal/pkg/main.go:" + line + ":" + column +
      ": could not import " + module + " (open " + path + ": no such file or directory)"
    assert.equal(cause([diagnostic(file)]), "Go cache archive", "witness " + index)
    for (const invalid of [
      file.slice(0, -1) + "a",
      cacheRoot + "/" + hash.slice(0, 2) + "/" + hash.slice(1) + "-d",
      cacheRoot + "/" + (hash.startsWith("ff") ? "00" : "ff") + "/" + hash + "-d",
    ]) assert.notEqual(cause([diagnostic(invalid)]), "Go cache archive", "witness " + index + ": " + diagnostic(invalid))
  }
})
