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
