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

// A whole seed run reached the old 20m deadline before completing. Keep the
// graph's test and task budgets consistent with the documented full run.
test("the fuzz seed target honors its documented deadline and build allowance", () => {
  const seconds = text => {
    const hit = /^(\d+)([smh])$/.exec(text)
    assert.ok(hit, "invalid deadline " + text)
    return Number(hit[1]) * ({ s: 1, m: 60, h: 3600 })[hit[2]]
  }
  const documented = /go test -short -count=1 -p 8 -timeout=([0-9]+[smh])/.exec(read("docs/research/fuzzing.md"))
  assert.ok(documented, "the corpus command must declare its deadline")
  const source = read("PACKAGE.ts")
  const start = source.indexOf('"go-vibelangfuzz": goVibelang(')
  const end = source.indexOf('"spec-tests":', start)
  assert.ok(start >= 0 && end > start)
  const target = source.slice(start, end)
  const testLimit = /go test [^"\n]*-timeout=([0-9]+[smh])/.exec(target)
  const taskLimit = /\n\s*"([0-9]+[smh])"\s*\n\s*\)/.exec(target)
  assert.ok(testLimit && taskLimit, "the seed target must declare both deadlines")
  assert.ok(seconds(testLimit[1]) >= seconds(documented[1]), "the graph truncates the documented seed run")
  assert.ok(seconds(taskLimit[1]) >= seconds(testLimit[1]) + 25 * 60, "the task deadline must leave the test its admission/build allowance")
})
