import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const script = process.env.GO_PROGRESS_SCRIPT ?? fileURLToPath(new URL("./go-test-progress.mjs", import.meta.url))

async function disconnect(t, seed, heartbeat = false) {
  const directory = mkdtempSync(join(tmpdir(), "go-progress-stderr-"))
  const depth = seed % 3, width = 1 + seed % 2
  const names = (name, remaining) => [name, ...(remaining
    ? Array.from({ length: width }, (_, i) => names(name + i, remaining - 1)).flat()
    : [])]
  const expected = names("root", depth), ready = new Set()
  const record = (name, suffix) => join(directory, name + suffix)
  const fixture = join(directory, "tree.mjs")
  const action = ["start", "pass", "skip", "fail", "build-fail"][seed % 5]
  const event = JSON.stringify({ Action: action, Package: "fixture", ImportPath: "fixture" }) + "\n"
  writeFileSync(fixture, [
    'import { spawn } from "node:child_process"',
    'import { writeFileSync } from "node:fs"',
    'const name = process.argv[2], depth = Number(process.argv[3])',
    'const directory = ' + JSON.stringify(directory),
    'writeFileSync(directory + "/" + name + ".pid", String(process.pid))',
    'process.on("SIGTERM", () => {',
    '  writeFileSync(directory + "/" + name + ".signal", "SIGTERM"); process.exit(0)',
    '})',
    'process.stdout.on("error", () => {})',
    'if (depth) for (let i = 0; i < ' + width + '; i++)',
    '  spawn(process.execPath, [import.meta.filename, name + i, String(depth - 1)], { stdio: "inherit" })',
    'process.stdout.write("fixture-ready:" + name + "\\n")',
    'if (name === "root") process.stdin.once("data", () => {',
    heartbeat ? '  // A quiet command exercises the real heartbeat after the reader closes.' :
      '  process.stdout.write(' + JSON.stringify(event) + ')',
    '})',
    'setTimeout(() => {',
    '  writeFileSync(directory + "/" + name + ".signal", "escaped"); process.exit(0)',
    '}, ' + (heartbeat ? 16000 : 5000) + ')',
  ].join("\n"))
  writeFileSync(join(directory, "go"),
    '#!/bin/sh\nexec "' + process.execPath + '" "' + fixture + '" root ' + depth + '\n', { mode: 0o700 })
  const monitor = join(directory, "monitor.mjs")
  writeFileSync(monitor, [
    'import { writeFileSync } from "node:fs"',
    'process.on("uncaughtExceptionMonitor", error => {',
    '  writeFileSync(' + JSON.stringify(join(directory, "uncaught")) + ', String(error.code))',
    '})',
  ].join("\n"))
  const child = spawn(process.execPath, ["--import", monitor, script, "go", "test", "-json", "private-fixture-argument"],
    { env: { ...process.env, PATH: directory }, stdio: ["pipe", "pipe", "pipe"] })
  let stdout = "", stderr = "", disconnected = false
  const deadline = setTimeout(() => { child.kill("SIGKILL"); child.stdout.destroy(); child.stderr.destroy() },
    heartbeat ? 22000 : 9000)
  child.stdin.on("error", () => {})
  t.after(() => {
    clearTimeout(deadline)
    try { process.kill(-Number(readFileSync(record("root", ".pid"), "utf8")), "SIGKILL") }
    catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) throw error }
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    rmSync(directory, { recursive: true, force: true })
  })
  child.stderr.on("data", bytes => { stderr += bytes })
  child.stdout.on("data", bytes => {
    stdout += bytes
    for (const match of stdout.matchAll(/fixture-ready:(root[01]*)\n/g)) ready.add(match[1])
    if (ready.size !== expected.length || disconnected) return
    disconnected = true
    child.stderr.destroy()
    child.stdin.end("trigger")
  })
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => resolve({ code, signal }))
  })
  assert.deepEqual([...ready].sort(), expected.sort(), "every owned process starts before disconnection")
  assert.equal(disconnected, true, "the actual diagnostic reader closes")
  assert.deepEqual(result, { code: 1, signal: null }, stderr)
  assert.equal(existsSync(join(directory, "uncaught")), false, "the stream error must be handled")
  for (const name of expected) {
    assert.equal(existsSync(record(name, ".signal")), true, "diagnostic failure must terminate " + name)
    assert.equal(readFileSync(record(name, ".signal"), "utf8"), "SIGTERM",
      "diagnostic failure must cancel " + name + " before its fallback")
  }
  if (!heartbeat) assert.ok(stdout.includes(event), "healthy stdout retains the event that encountered the diagnostic error")
  assert.doesNotMatch(stdout, /go-progress|go-failure|private-fixture-argument/, "diagnostics must not be injected into stdout")
  assert.doesNotMatch(stderr, /private-fixture-argument|tree\.mjs|go-progress-stderr-/, "progress omits private paths and arguments")
}

for (let seed = 1; seed <= 12; seed++) {
  test("Go progress cancels its process tree when the diagnostic reader closes, seed " + seed,
    { skip: process.platform === "win32" }, t => disconnect(t, seed))
}
test("Go progress cancels a quiet process tree when heartbeat diagnostics disconnect",
  { skip: process.platform === "win32" }, t => disconnect(t, 8, true))
