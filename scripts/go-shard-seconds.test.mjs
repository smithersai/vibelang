import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { MIN_SECONDS, render, shardSeconds } from "./go-shard-seconds.mjs"

const script = fileURLToPath(new URL("./go-shard-seconds.mjs", import.meta.url))

const log = `=== RUN   TestSlow
=== RUN   TestSlow/one
    --- PASS: TestSlow/one (40.00s)
--- PASS: TestSlow (41.20s)
=== RUN   FuzzSeeds
=== RUN   FuzzSeeds/seed#0
    --- PASS: FuzzSeeds/seed#0 (3.10s)
--- FAIL: FuzzBroken (700.00s)
--- SKIP: FuzzSeeds (7.00s)
--- SKIP: TestMissing (0.00s)
--- PASS: TestQuick (0.49s)
--- PASS: TestBorder (${MIN_SECONDS - 0.5}s)
ok  	example.com/pkg	50.123s
`

test("top-level passes and skips only, rounded up, slowest first, names under the floor and failing runs left out", () => {
  assert.deepEqual(shardSeconds([log]), [["TestSlow", 42], ["FuzzSeeds", 7], ["TestBorder", MIN_SECONDS]])
})

test("the slowest of several logs wins and equal seconds sort by name", () => {
  const other = "--- PASS: TestSlow (12.00s)\n--- PASS: FuzzSeeds (20.00s)\n--- PASS: TestAlpha (20.00s)\n"
  assert.deepEqual(shardSeconds([log, other]), [["TestSlow", 42], ["FuzzSeeds", 20], ["TestAlpha", 20], ["TestBorder", MIN_SECONDS]])
})

test("the file the shard script reads: a header, then `<seconds> <name>` lines", () => {
  const text = render([["TestSlow", 42], ["FuzzSeeds", 7]], { date: "2026-01-02", note: "four processes on a 4-vCPU box" })
  const lines = text.split("\n")
  assert.ok(lines[0].startsWith("# Seconds each test or fuzz target took, slowest run of each name (2026-01-02, four processes on a 4-vCPU box)"))
  assert.deepEqual(lines.filter((line) => !line.startsWith("#")), ["42 TestSlow", "7 FuzzSeeds", ""])
  // The shard script's awk reads field 1 as the weight and field 2 as the name of every non-comment line.
  for (const line of lines.filter((line) => line && !line.startsWith("#"))) assert.match(line, /^\d+ (Test|Fuzz|Example)\S*$/)
})

test("the command writes testdata/shard-seconds.txt and refuses a log without -v lines", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go-shard-seconds-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const pkg = path.join(dir, "pkg")
  fs.mkdirSync(pkg)
  fs.writeFileSync(path.join(dir, "a.log"), log)
  const printed = execFileSync(process.execPath, [script, pkg, path.join(dir, "a.log"), "--note", "one process"], { encoding: "utf8" })
  assert.match(printed, /3 names, slowest 42 s TestSlow/)
  const written = fs.readFileSync(path.join(pkg, "testdata", "shard-seconds.txt"), "utf8")
  assert.ok(written.includes("one process"))
  assert.deepEqual(written.split("\n").filter((line) => !line.startsWith("#")), ["42 TestSlow", "7 FuzzSeeds", `${MIN_SECONDS} TestBorder`, ""])
  fs.writeFileSync(path.join(dir, "quiet.log"), "ok  \texample.com/pkg\t1.000s\n")
  assert.throws(() => execFileSync(process.execPath, [script, pkg, path.join(dir, "quiet.log")], { encoding: "utf8", stdio: "pipe" }),
    (error) => error.status === 1 && /run go test with -v/.test(error.stderr))
})

const moment = ms => new Date(Date.UTC(2020, 0, 1) + ms).toISOString()
const event = (Action, Test, ms, extra = {}) => JSON.stringify({ Time: moment(ms), Action, Package: "compiler/fuzz", ...(Test ? { Test } : {}), ...extra })
const parallelTrace = (ms, elapsed = 0.01) => [
  event("run", "FuzzParallel", 0),
  event("run", "FuzzParallel/seed#0", 1),
  event("pause", "FuzzParallel/seed#0", 2),
  event("cont", "FuzzParallel/seed#0", 3),
  event("pass", "FuzzParallel/seed#0", ms - 1, { Elapsed: (ms - 4) / 1000 }),
  event("pass", "FuzzParallel", ms, { Elapsed: elapsed }),
].join("\n")

test("JSON timestamps include parallel seed work omitted from the parent's elapsed field", () => {
  assert.deepEqual(shardSeconds([parallelTrace(305000, 0.47)]), [["FuzzParallel", 305]])
})

test("generated parallel schedules retain their full cost across short parent durations", () => {
  for (const ms of [5001, 10001, 60001, 300001, 719001]) {
    for (const parent of [0, 0.01, 0.47, 1]) {
      assert.deepEqual(shardSeconds([parallelTrace(ms, parent)]), [["FuzzParallel", Math.ceil(ms / 1000)]])
    }
  }
})

test("JSON excludes a top-level test's paused queue time and retains reported elapsed when larger", () => {
  const trace = [
    event("run", "TestQueued", 0), event("pause", "TestQueued", 1000),
    event("cont", "TestQueued", 61000), event("pass", "TestQueued", 66000, { Elapsed: 1 }),
    event("run", "TestReported", 70000), event("pass", "TestReported", 71000, { Elapsed: 7 }),
  ].join("\n")
  assert.deepEqual(shardSeconds([trace]), [["TestReported", 7], ["TestQueued", 6]])
})

test("parallel verbose logs, cached JSON and incomplete JSON cannot silently underweight a target", () => {
  assert.throws(() => shardSeconds(["=== PAUSE FuzzParallel/seed#0\n--- PASS: FuzzParallel (0.01s)\n"]), /parallel.*-json/)
  assert.throws(() => shardSeconds([event("output", undefined, 0, { Output: "ok compiler/fuzz (cached)\n" })]), /-count=1/)
  assert.throws(() => shardSeconds([event("pass", "FuzzParallel", 300000, { Elapsed: 0.01 })]), /run event/)
})

test("updating a cost file replaces observed skipped costs and preserves unobserved names", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go-shard-seconds-update-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const pkg = path.join(dir, "pkg"), data = path.join(pkg, "testdata")
  fs.mkdirSync(data, { recursive: true })
  fs.writeFileSync(path.join(data, "shard-seconds.txt"), "654 TestFullMatrix\n113 TestRetained\n")
  fs.writeFileSync(path.join(dir, "current.jsonl"), parallelTrace(305000) + "\n" +
    event("run", "TestFullMatrix", 400000) + "\n" + event("skip", "TestFullMatrix", 400000, { Elapsed: 0 }))
  execFileSync(process.execPath, [script, pkg, path.join(dir, "current.jsonl"), "--update"], { stdio: "pipe" })
  const written = fs.readFileSync(path.join(data, "shard-seconds.txt"), "utf8")
  assert.ok(written.includes("305 FuzzParallel\n"))
  assert.ok(written.includes("113 TestRetained\n"))
  assert.ok(!written.includes("TestFullMatrix"))
})

test("JSON nanosecond boundaries round up rather than dropping parallel work", () => {
  const start = "2020-01-01T00:00:00Z"
  const end = "2020-01-01T00:00:05.000000001Z"
  const trace = [
    JSON.stringify({ Time: start, Action: "run", Package: "p", Test: "FuzzPrecise" }),
    JSON.stringify({ Time: end, Action: "pass", Package: "p", Test: "FuzzPrecise", Elapsed: 0.01 }),
  ].join("\n")
  assert.deepEqual(shardSeconds([trace]), [["FuzzPrecise", 6]])
})

test("unfinished and backwards JSON streams cannot produce a partial cost file", () => {
  assert.throws(() => shardSeconds([event("run", "TestPending", 0)]), /unfinished/)
  const backwards = [
    event("run", "TestClock", 0), event("pause", "TestClock", 10000),
    event("cont", "TestClock", 5000), event("pass", "TestClock", 12000, { Elapsed: 1 }),
  ].join("\n")
  assert.throws(() => shardSeconds([backwards]), /backwards/)
})


test("interleaved packages keep independent run clocks for the same test name", () => {
  const trace = [
    event("run", "TestShared", 0),
    JSON.stringify({ Time: moment(1000), Action: "run", Package: "other", Test: "TestShared" }),
    event("pass", "TestShared", 10000, { Elapsed: 0.01 }),
    JSON.stringify({ Time: moment(21000), Action: "pass", Package: "other", Test: "TestShared", Elapsed: 0.01 }),
  ].join("\n")
  assert.deepEqual(shardSeconds([trace]), [["TestShared", 20]])
})

test("a fixture mentioning cached output does not masquerade as a cached package result", () => {
  const trace = event("output", undefined, 0, { Output: "fixture mentions (cached) in a message\n" }) + "\n" + parallelTrace(6000)
  assert.deepEqual(shardSeconds([trace]), [["FuzzParallel", 6]])
})

test("an update with no measurements cannot claim a refresh or overwrite the ledger", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go-shard-empty-update-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const pkg = path.join(dir, "pkg"), data = path.join(pkg, "testdata")
  fs.mkdirSync(data, { recursive: true })
  const file = path.join(data, "shard-seconds.txt"), before = "654 TestFullMatrix\n"
  fs.writeFileSync(file, before)
  fs.writeFileSync(path.join(dir, "quiet.log"), "ok package 1s\n")
  assert.throws(() => execFileSync(process.execPath, [script, pkg, path.join(dir, "quiet.log"), "--update"], { stdio: "pipe" }))
  assert.equal(fs.readFileSync(file, "utf8"), before)
  fs.writeFileSync(path.join(dir, "skip.jsonl"), event("run", "TestFullMatrix", 0) + "\n" + event("skip", "TestFullMatrix", 0, { Elapsed: 0 }))
  const output = execFileSync(process.execPath, [script, pkg, path.join(dir, "skip.jsonl"), "--update"], { encoding: "utf8" })
  assert.match(output, /0 names/)
  assert.ok(!fs.readFileSync(file, "utf8").includes("TestFullMatrix"))
})
