import { declarationTargets } from "./testing/package-declaration.mjs"
import { tmpdir } from "node:os"
import { join, delimiter } from "node:path"
import { spawnSync } from "node:child_process"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { test } from "node:test"

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8")

// The build graph caches each Go test target, so Go's own test cache only adds work: before it stores a result,
// `go test` hashes every file the tests opened. The fuzz suite opens about 25 million, which kept
// //:go-vibelangfuzz busy on one core for some 14 minutes after its tests passed.
test("the repository-wide Go test targets bypass Go's test cache", () => {
  const calls = read("PACKAGE.ts").match(/go test [^`"]*/g)
  assert.ok(calls.length >= 5, calls.join("\n"))
  for (const call of calls) assert.match(call, /(^| )-count=1( |$)/, call)
})

test("repository Go tests reread an oracle outside the Go module", () => {
  const command = read("PACKAGE.ts").match(/go test ([^`"]*)/)[1]
  const flags = command.includes("-count=1") ? ["-count=1"] : []
  const root = mkdtempSync(join(tmpdir(), "vibelang-go-oracle-"))
  try {
    const module = join(root, "module")
    mkdirSync(module)
    writeFileSync(join(module, "go.mod"), "module oracle.test\n\ngo 1.27\n")
    writeFileSync(join(module, "oracle_test.go"), `package oracle
import ("os"; "testing")
func TestExternalOracle(t *testing.T) {
  b, err := os.ReadFile("../oracle.txt")
  if err != nil { t.Fatal(err) }
  if string(b) != "pass" { t.Fatalf("external oracle changed: %s", b) }
}
`)
    const goroot = spawnSync("go", ["env", "GOROOT"], { encoding: "utf8" })
    assert.equal(goroot.status, 0, goroot.stderr)
    const toolPath = join(goroot.stdout.trim(), "bin")
    const run = () => spawnSync("go", ["test", ...flags, "-p", "8", "./..."], {
      cwd: module, encoding: "utf8", timeout: 180_000,
      env: { ...process.env, GOMAXPROCS: "8", PATH: toolPath + delimiter + process.env.PATH },
    })
    writeFileSync(join(root, "oracle.txt"), "pass")
    const first = run()
    assert.equal(first.status, 0, first.stdout + first.stderr)
    writeFileSync(join(root, "oracle.txt"), "fail")
    const second = run()
    assert.equal(second.status, 1, "must rerun after an external oracle changes: " + second.stdout + second.stderr)
    assert.match(second.stdout + second.stderr, /--- FAIL: TestExternalOracle/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// The complete manual command retains its corpus budget; each graph slice
// has its own bounded test deadline and room for compilation.
test("fuzz seed shards retain the complete run and bounded build allowance", () => {
  const graph = declarationTargets("PACKAGE.ts")
  const shards = graph["go-vibelangfuzz"].tests
  assert.ok(shards.length >= 16)
  assert.match(read("docs/research/fuzzing.md"), /go test -short -count=1 -p 8 -timeout=40m/)
  for (const shard of shards) {
    assert.match(shard.shell, /go test -short -count=1 -timeout=8m -trimpath -exec /)
    assert.equal(shard.timeout, "10m", "reserve two minutes for compilation")
    assert.match(shard.env.GO_TEST_SLICE, /^\d+\/\d+$/)
    assert.equal(shard.env.GO_TEST_SHARDS, "2")
  }
})

test("the spec gate's compile replays share every fuzz shard's stage watchdog", () => {
  const graph = declarationTargets("PACKAGE.ts")
  const spec = graph["spec-tests"]
  for (const shard of graph["go-vibelangfuzz"].tests) {
    const budget = /VIBELANG_FUZZ_HANG=([0-9]+[smh])/.exec(shard.shell)
    assert.ok(budget, "every shard declares the stage watchdog")
    assert.match(spec.shell, new RegExp("VIBELANG_FUZZ_HANG=" + budget[1] + "(?: |$)"),
      "compiled spec regressions must not inherit the short default watchdog")
  }
})
