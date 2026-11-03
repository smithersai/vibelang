import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

const source = process.env.VIBELANG_FAILFAST_SCRIPT ?? new URL("./go-test-shards.sh", import.meta.url).pathname
const names = ["TestA", "TestB", "TestC", "TestD"]
const truth = new Map([["true", true], ["TRUE", true], ["1", true], ["false", false], ["FALSE", false], ["0", false], ["t", true], ["T", true], ["True", true], ["f", false], ["F", false], ["False", false]])

function run(args, shards = 2) {
  const root = mkdtempSync(join(tmpdir(), "shard-failfast-"))
  try {
    const script = join(root, "shards.sh")
    writeFileSync(script, readFileSync(source))
    const binary = join(root, "peer.mjs")
    const trace = join(root, "trace.jsonl")
    writeFileSync(binary, String.raw`#!${process.execPath}
import { appendFileSync } from "node:fs"
const args = process.argv.slice(2)
const names = ${JSON.stringify(names)}
const listed = args.includes("-test.list")
appendFileSync(process.env.TRACE, JSON.stringify({ args, listed }) + "\n")
if (listed) { console.log(names.join("\n")); process.exit(0) }
const truth = new Map(${JSON.stringify([...truth])})
let failfast = false
for (const arg of args) {
  const match = /^--?test\.failfast(?:=(.*))?$/.exec(arg)
  if (!match) continue
  if (match[1] !== undefined && !truth.has(match[1])) process.exit(2)
  failfast = match[1] === undefined ? true : truth.get(match[1])
}
const run = args.find(arg => arg.startsWith("-test.run="))?.slice("-test.run=".length)
let status = 0
for (const name of names) {
  if (run && !new RegExp(run).test(name)) continue
  console.log("EXEC " + name)
  if (name === "TestA") {
    status = 1
    if (failfast) break
  }
}
process.exit(status)
`, { mode: 0o700 })
    const result = spawnSync("/bin/sh", [script, binary, ...args], {
      cwd: root, encoding: "utf8", timeout: 15_000,
      env: { ...process.env, TRACE: trace, GO_TEST_SLICE: "", GO_TEST_SHARDS: String(shards), TMPDIR: root },
    })
    assert.ifError(result.error)
    let calls
    try {
      calls = readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line))
    } catch (error) {
      assert.fail("fixture trace unavailable or invalid (exit " + result.status + "): " + result.stderr + "; " + error.message)
    }
    const executed = result.stdout.split("\n").filter(line => line.startsWith("EXEC ")).map(line => line.slice(5)).sort()
    return { ...result, calls, executed }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("ordinary runs keep all tests and their failure status across shards", () => {
  const result = run(["-test.v"])
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.deepEqual(result.executed, names)
  assert.equal(result.calls.filter(call => !call.listed).length, 2)
})

test("a one-process native fail-fast control skips every test after its first failure", () => {
  const result = run(["-test.failfast", "-test.v"], 1)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.deepEqual(result.executed, ["TestA"])
})

for (const flags of [
  ["-test.failfast"], ["-test.failfast=true"], ["--test.failfast"], ["--test.failfast=true"],
  ["-test.failfast=1"], ["--test.failfast=TRUE"],
  ["-test.failfast=false"], ["--test.failfast=false"], ["-test.failfast=0"], ["--test.failfast=FALSE"],
  ["-test.failfast=false", "-test.failfast=true"],
  ["--test.failfast=true", "--test.failfast=false"],
  ["-test.failfast=invalid"], ["--test.failfast=invalid"],
]) {
  test("fail-fast flags reach one native process unchanged: " + flags.join(" "), () => {
    const args = ["-test.v", ...flags, "-test.short=true"]
    const result = run(args)
    assert.ok([1, 2].includes(result.status), result.stdout + result.stderr)
    assert.equal(result.calls.length, 1, JSON.stringify(result.calls))
    assert.deepEqual(result.calls[0], { args, listed: false })
    const last = flags.at(-1)
    if (last.endsWith("invalid")) {
      assert.equal(result.status, 2)
      assert.deepEqual(result.executed, [])
    } else {
      assert.equal(result.status, 1)
      assert.deepEqual(result.executed, /=(?:false|FALSE|0)$/.test(last) ? names : ["TestA"])
    }
  })
}

// Generated flag sequences cover both dash spellings, Go ParseBool spellings,
// last-value precedence and the original shard-count control.
test("generated fail-fast sequences retain native boolean and argument semantics", () => {
  const entries = [...truth]
  for (let seed = 0; seed < 36; seed++) {
    const [value, enabled] = entries[seed % entries.length]
    const flags = ["-test.failfast=" + (enabled ? "false" : "true"),
      (seed % 2 ? "--" : "-") + "test.failfast=" + value]
    const result = run(flags, 2 + seed % 4)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.deepEqual(result.calls, [{ args: flags, listed: false }])
    assert.deepEqual(result.executed, enabled ? ["TestA"] : names)
  }
})
