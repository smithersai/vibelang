import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

const source = new URL("./go-test-shards.sh", import.meta.url)
const peer = `#!${process.execPath}
import { appendFileSync } from "node:fs"
const args = process.argv.slice(2)
appendFileSync(process.env.FUZZ_DISPATCH_RUNS, JSON.stringify(args) + "\\n")
if (args.includes("-test.list")) { console.log("TestA\\nFuzzD\\nFuzzE"); process.exit(0) }
console.log("fixture fuzz output")
console.error("fixture fuzz diagnostic")
process.exit(Number(process.env.FUZZ_DISPATCH_STATUS))
`

function run(t, args, status = 0) {
  const dir = mkdtempSync(join(tmpdir(), "fuzz dispatch-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const script = join(dir, "go-test-shards.sh"), bin = join(dir, "peer.mjs"), runs = join(dir, "runs.jsonl")
  // Keep host-specific go-test-slice files out of the fixture.
  writeFileSync(script, readFileSync(source))
  writeFileSync(bin, peer, { mode: 0o700 })
  const result = spawnSync("sh", [script, bin, ...args], {
    cwd: dir, encoding: "utf8", timeout: 10_000,
    env: { ...process.env, TMPDIR: dir, GO_TEST_SLICE: "", GO_TEST_SHARDS: "3",
      FUZZ_DISPATCH_RUNS: runs, FUZZ_DISPATCH_STATUS: String(status) }
  })
  assert.equal(result.error, undefined, result.stderr)
  return { ...result, runs: readFileSync(runs, "utf8").trim().split("\n").map(line => JSON.parse(line)) }
}

for (const args of [
  ["-test.fuzz", "FuzzD"],
  ["-test.fuzz", "^FuzzD$"],
  ["-test.fuzz", "Fuzz(D|E)"],
  ["-test.fuzz", "", "-test.fuzztime=1x"],
  ["-test.fuzz", "[", "-test.fuzztime=1x"],
  ["-test.fuzz=FuzzE", "-test.fuzz", "FuzzD"],
  ["-test.fuzztime=1x", "-test.fuzz", "FuzzD", "-test.fuzzcachedir", "corpus with spaces"],
]) {
  test("active fuzz selection runs once with unchanged arguments: " + JSON.stringify(args), t => {
    const result = run(t, args)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.deepEqual(result.runs, [args], "no discovery or shard selector may multiply an active fuzz campaign")
    assert.equal(result.stdout, "fixture fuzz output\n")
    assert.equal(result.stderr, "fixture fuzz diagnostic\n")
  })
}

for (const status of [1, 7, 137]) {
  test("split active fuzz selection preserves exit status " + status, t => {
    const args = ["-test.short=true", "-test.fuzz", "FuzzD", "-test.fuzztime=1x"]
    const result = run(t, args, status)
    assert.equal(result.status, status)
    assert.deepEqual(result.runs, [args])
    assert.equal(result.stderr, "fixture fuzz diagnostic\n")
  })
}

test("equals active fuzz selection retains its existing single-run behavior", t => {
  const args = ["-test.fuzz=FuzzD", "-test.fuzztime=1x"]
  const result = run(t, args)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.runs, [args])
})

test("fuzz configuration without an active selector still shards the seed corpus", t => {
  const args = ["-test.fuzztime=1x", "-test.fuzzcachedir=corpus with spaces"]
  const result = run(t, args)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.runs[0], [...args, "-test.list", ".*"])
  assert.equal(result.runs.length, 4)
  const selectors = result.runs.slice(1).map(argv => {
    assert.deepEqual(argv.slice(0, -1), args)
    return argv.at(-1)
  })
  assert.deepEqual(selectors.sort(), ["-test.run=^(FuzzD)$", "-test.run=^(FuzzE)$", "-test.run=^(TestA)$"])
})
