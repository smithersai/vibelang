import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { checkProperty } from "./testing/property.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const require = createRequire(new URL("../packages/compiler/package.json", import.meta.url))
const fc = require("fast-check")
const modulePath = process.env.PARITY_COMMAND_MODULE || join(root, "packages/ts-mapper/test/parity/command.ts")

function run(requests) {
  const driver = "import { exec } from " + JSON.stringify(modulePath) +
    "; const items = JSON.parse(process.argv[1]); console.log(JSON.stringify(await Promise.all(items.map(c => exec(c.argv, c.cwd, c.timeout)))))"
  const child = spawnSync("bun", ["-e", driver, JSON.stringify(requests)], { encoding: "utf8", timeout: 15_000 })
  assert.equal(child.error, undefined, child.stdout + child.stderr)
  assert.equal(child.status, 0, child.stdout + child.stderr)
  return JSON.parse(child.stdout)
}
const request = (code, timeout = 10_000) => ({ argv: [process.execPath, "-e", code], cwd: root, timeout })
const quote = text => "'" + text.replaceAll("'", "'\\''") + "'"

function running(pid) {
  try {
    process.kill(pid, 0)
    return process.platform !== "linux" || readFileSync("/proc/" + pid + "/stat", "utf8").split(") ")[1][0] !== "Z"
  } catch (error) {
    if (["ESRCH", "ENOENT"].includes(error.code)) return false
    throw error
  }
}

test("both parity columns route commands through the shared deadline owner", () => {
  for (const name of ["runtime", "parity"]) {
    const source = readFileSync(join(root, "packages/ts-mapper/test/parity", name + ".ts"), "utf8")
    assert.match(source, /import\s*\{\s*exec(?:\s+as\s+runCommand)?\s*\}\s*from\s*["']\.\/command["']/)
    assert.doesNotMatch(source, /Bun\.spawn\(/, name + " must not keep a separate command lifecycle")
  }
})

test("parity commands retain literal arguments, cwd, Unicode and both streams", () => {
  const input = request('console.log(process.cwd()); console.log(process.argv[1]); console.error("雪😀")')
  input.argv.push("a b;$HOME")
  assert.deepEqual(run([input]), [{ code: 0, stdout: root.replace(/[\\/]$/, "") + "\na b;$HOME\n", stderr: "雪😀\n" }])
})

test("parity commands retain ordinary nonzero exit status", () => {
  assert.deepEqual(run([request('console.log("partial"); console.error("failure"); process.exit(7)')]),
    [{ code: 7, stdout: "partial\n", stderr: "failure\n" }])
})

test("a direct command deadline retains partial output and names the timeout", () => {
  const [result] = run([request('console.log("started"); console.error("err"); setInterval(() => {}, 1000)', 200)])
  assert.match(result.code, /timed out after 200 ms/)
  assert.equal(result.stdout, "started\n")
  assert.equal(result.stderr, "err\n")
})

test("one deadline does not kill an independent concurrent command", () => {
  const [killed, retained] = run([
    request("setInterval(() => {}, 1000)", 100),
    request('setTimeout(() => console.log("independent"), 400)')
  ])
  assert.match(killed.code, /timed out after 100 ms/)
  assert.deepEqual(retained, { code: 0, stdout: "independent\n", stderr: "" })
})

test("spawn failures propagate rather than becoming successful commands", () => {
  assert.throws(() => run([{ argv: [join(root, "missing-command-129")], cwd: root, timeout: 200 }]), /ENOENT|Executable not found/i)
})

test("a spontaneous signal remains distinct from a command deadline", { skip: process.platform === "win32" }, () => {
  const [result] = run([request('process.kill(process.pid, "SIGTERM")')])
  assert.equal(result.code, "killed by SIGTERM")
})

async function descendants({ exits, stream, depth, noise }) {
  const temp = mkdtempSync(join(tmpdir(), "vibelang-parity-command-"))
  const pidfile = join(temp, "owned-pids")
  const record = "echo $$ >> " + quote(pidfile) + "; "
  let script = record + "trap '' TERM; sleep 1; echo ESCAPED >&" + (stream === "stderr" ? 2 : 1)
  for (let i = 0; i < depth; i++) script = record + "sh -c " + quote(script) + " & wait"
  const redirects = stream === "stdout" ? "2>/dev/null" : stream === "stderr" ? ">/dev/null" : ""
  const text = "雪😀".repeat(noise)
  const argv = ["sh", "-c", record + "sh -c " + quote(script) + " " + redirects + " & " +
    "printf '%s' " + quote(text) + " >&2; " + (exits ? "exit 0" : "wait")]
  let pids = []
  try {
    const [result] = run([{ argv, cwd: temp, timeout: 200 }])
    assert.ok(existsSync(pidfile), "the fixture must start before the timeout")
    pids = readFileSync(pidfile, "utf8").trim().split("\n").map(Number)
    assert.ok(pids.length >= depth + 2 && pids.every(pid => Number.isSafeInteger(pid) && pid > 1))
    assert.match(result.code, /timed out after 200 ms/, JSON.stringify(result))
    assert.equal(result.stdout, "")
    assert.equal(result.stderr, text)
    for (let attempt = 0; attempt < 100 && pids.some(running); attempt++) await sleep(10)
    assert.deepEqual(pids.filter(running), [], "no owned process may keep running")
  } finally {
    if (!pids.length && existsSync(pidfile)) pids = readFileSync(pidfile, "utf8").trim().split("\n").map(Number)
    for (const pid of pids) if (Number.isSafeInteger(pid) && pid > 1 && running(pid)) {
      try { process.kill(pid, "SIGKILL") } catch (error) { if (error.code !== "ESRCH") throw error }
    }
    rmSync(temp, { recursive: true, force: true })
  }
}

for (const exits of [false, true]) for (const stream of ["stdout", "stderr", "both"]) {
  test("parity deadline stops " + stream + " holders after parent " + (exits ? "exit" : "wait"),
    { skip: process.platform === "win32" }, () => descendants({ exits, stream, depth: 1, noise: 10 }))
}

test("generated process trees stay bounded across stream ownership and output pressure", { skip: process.platform === "win32" }, async () => {
  await checkProperty(fc, {
    name: "mapper-parity-command-descendants",
    rule: "Runner invariant: the command deadline covers process exit and inherited output pipes; it kills the owned POSIX process group and reports a timeout even if its parent has already exited zero.",
    command: "node --test scripts/mapper-parity-command.test.mjs",
    arbitrary: fc.record({ exits: fc.boolean(), stream: fc.constantFrom("stdout", "stderr", "both"),
      depth: fc.integer({ min: 0, max: 3 }), noise: fc.integer({ min: 0, max: 2048 }) }),
    numRuns: 24,
    check: descendants
  })
})
