import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

const source = process.env.VIBELANG_NATIVE_FLAGS_SCRIPT ?? new URL("./go-test-shards.sh", import.meta.url)
const peer = [
  "#!" + process.execPath,
  'import { appendFileSync } from "node:fs"',
  'const args = process.argv.slice(2)',
  'appendFileSync(process.env.NATIVE_FLAGS_CALLS, JSON.stringify(args) + "\\n")',
  'if (args.includes("-test.list")) { console.log("TestA\\nTestB\\nFuzzD"); process.exit(0) }',
  'console.log("native fixture output")',
  'console.error("native fixture diagnostic")',
  'process.exit(Number(process.env.NATIVE_FLAGS_STATUS))'
].join("\n")
function run(t, args, status = 0) {
  const dir = mkdtempSync(join(tmpdir(), "native Go flags-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const script = join(dir, "shards.sh"), bin = join(dir, "peer.mjs"), trace = join(dir, "calls")
  writeFileSync(script, readFileSync(source))
  writeFileSync(bin, peer, { mode: 0o700 })
  const result = spawnSync("sh", [script, bin, ...args], {
    cwd: dir, encoding: "utf8", timeout: 15_000,
    env: { ...process.env, GO_TEST_SLICE: "", GO_TEST_SHARDS: "3", TMPDIR: dir,
      NATIVE_FLAGS_CALLS: trace, NATIVE_FLAGS_STATUS: String(status) }
  })
  assert.ifError(result.error)
  return { ...result, calls: readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line)) }
}
const selectors = [
  ["--test.run=^TestB$"], ["--test.run", "^TestB$"],
  ["--test.list=Test"], ["--test.list", "Test"],
  ["--test.fuzz=FuzzD"], ["--test.fuzz", "FuzzD"],
  ["--test.bench=BenchmarkA"], ["--test.bench", "BenchmarkA"],
  ["--test.v=test2json"],
  ["-test.run=TestA", "--test.run", "TestB"],
]
for (const flag of ["coverprofile", "cpuprofile", "memprofile", "blockprofile", "mutexprofile", "trace"]) {
  selectors.push(["--test." + flag + "=output with spaces"])
  selectors.push(["--test." + flag, "output with spaces"])
}
for (const args of selectors) test("native double-dash flags run once intact: " + JSON.stringify(args), t => {
  const result = run(t, args)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(result.calls, [args])
  assert.equal(result.stdout, "native fixture output\n")
  assert.equal(result.stderr, "native fixture diagnostic\n")
})
for (const status of [1, 2, 7, 137]) test("double-dash dispatch retains native exit " + status, t => {
  const args = ["--test.run", "["] // validation belongs to the native flag parser
  const result = run(t, args, status)
  assert.equal(result.status, status)
  assert.deepEqual(result.calls, [args])
})
test("ordinary double-dash settings still shard seed tests", t => {
  const args = ["--test.v=true", "--test.fuzztime=1x", "--test.memprofilerate=1"]
  const result = run(t, args)
  assert.equal(result.status, 0)
  assert.deepEqual(result.calls.filter(call => call.includes("-test.list")), [[...args, "-test.list", ".*"]])
  const shards = result.calls.filter(call => !call.includes("-test.list"))
  assert.equal(shards.length, 3)
  for (const call of shards) {
    assert.deepEqual(call.slice(0, args.length), args)
    assert.match(call.at(-1), /^-test\.run=/)
  }
})
test("single-dash selector control remains unchanged", t => {
  const args = ["-test.run=TestB"]
  const result = run(t, args)
  assert.equal(result.status, 0)
  assert.deepEqual(result.calls, [args])
})
