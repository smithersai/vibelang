import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const script = fileURLToPath(new URL("./go-test-shards.sh", import.meta.url))

// Model Go flag parsing (stop at the first positional argument), rather than
// searching all arguments for a selector that the real binary would ignore.
// The retained native testing.Main reproduction confirms this boundary.
const binary = `#!${process.execPath}
import { appendFileSync } from "node:fs"
const args = process.argv.slice(2)
let list = false, run
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (!arg.startsWith("-") || arg === "-" || arg === "--") break
  if (arg === "-test.list") { list = true; i++ }
  else if (arg.startsWith("-test.list=")) list = true
  else if (arg.startsWith("-test.run=")) run = arg.slice("-test.run=".length)
}
const names = ["TestA", "TestB", "TestC"]
const selected = names.filter(name => !run || new RegExp(run).test(name))
appendFileSync(process.env.SHARD_POSITIONAL_TRACE, JSON.stringify({ args, executed: list ? [] : selected }) + "\\n")
if (list) console.log(names.join("\\n"))
else {
  for (const name of selected) console.log("EXEC " + name)
  if (process.env.SHARD_POSITIONAL_FAILURE === "yes" && selected.includes("TestB")) process.exitCode = 7
}
`

function check(t, args, { sharded = false, failure = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "go shard positional-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const peer = join(root, "peer.mjs")
  const trace = join(root, "trace.jsonl")
  mkdirSync(join(root, "tmp"))
  writeFileSync(peer, binary, { mode: 0o700 })
  const result = spawnSync("/bin/sh", [script, peer, ...args], {
    cwd: root, encoding: "utf8", timeout: 15_000, killSignal: "SIGKILL",
    env: {
      ...process.env, GO_TEST_SLICE: "1/1", GO_TEST_SHARDS: "3", TMPDIR: join(root, "tmp"),
      SHARD_POSITIONAL_TRACE: trace, SHARD_POSITIONAL_FAILURE: failure ? "yes" : "no"
    }
  })
  assert.equal(result.error, undefined, result.stdout + result.stderr)
  assert.equal(result.status, failure ? 7 : 0, result.stdout + result.stderr)
  const invocations = readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line))
  const calls = invocations.map(call => call.args)
  assert.deepEqual(invocations.flatMap(call => call.executed).sort(), ["TestA", "TestB", "TestC"],
    "test executions during discovery must be counted too")
  assert.deepEqual(result.stdout.split("\n").filter(line => line.startsWith("EXEC ")).sort(),
    ["EXEC TestA", "EXEC TestB", "EXEC TestC"], "each test must execute once")
  if (sharded) {
    assert.equal(calls.length, 4, "one discovery and three test processes")
    assert.equal(calls.filter(args => args.some(arg => arg.startsWith("-test.run="))).length, 3)
  } else {
    assert.deepEqual(calls, [args], "pass through once, without discovery or argument changes")
  }
}

test("equals-form options still shard every test once", t => {
  check(t, ["-test.timeout=40m0s", "-test.short=true", "-test.v"], { sharded: true })
})

for (const args of [
  ["--"],
  ["-test.v", "--"],
  ["--", "-test.short=false"],
  ["--", "-test.v", "--application=雪"],
  ["custom"],
  ["-test.v", "custom"],
  ["-test.v", "custom", "argument with spaces"],
  ["-test.v", ""],
  ["-test.v", "-"],
  ["-test.v", "café 雪 😀", "-test.short=false"],
  ["-custom-mode", "fixture with spaces"],
  ["-test.timeout", "40m0s", "custom"]
]) {
  test("positional arguments preserve native single execution: " + JSON.stringify(args), t => check(t, args))
}

test("positional passthrough retains the binary's failure status", t => {
  check(t, ["-test.v", "custom"], { failure: true })
})

test("positional passthrough preserves generated argument vectors", async t => {
  const words = ["plain", "with spaces", "", "-", "雪", "😀", "-test.short=false", "quote'and\""]
  for (let i = 0; i < 32; i++) {
    const args = ["-test.v", "position" + i, words[i % words.length], words[Math.floor(i / words.length)]]
    await t.test(String(i), t => check(t, args, { failure: i % 5 === 0 }))
  }
})

test("end-of-options passthrough preserves generated flag-looking arguments", async t => {
  const words = ["plain", "with spaces", "雪", "😀", "quote"]
  for (let i = 0; i < 32; i++) {
    const args = [...(i % 2 ? ["-test.v"] : []), "--", "--application=" + i,
      "-opaque=" + words[i % words.length]]
    await t.test(String(i), t => check(t, args, { failure: i % 5 === 0 }))
  }
})
