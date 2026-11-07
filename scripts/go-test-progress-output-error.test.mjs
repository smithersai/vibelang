import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, delimiter } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const script = fileURLToPath(new URL("./go-test-progress.mjs", import.meta.url))

async function disconnect(t, seed, paused) {
  const directory = mkdtempSync(join(tmpdir(), "go-progress-output-"))
  const depth = seed % 3, width = 1 + seed % 2
  const identities = (name, remaining) => [name, ...(remaining
    ? Array.from({ length: width }, (_, i) => identities(name + i, remaining - 1)).flat()
    : [])]
  const expected = identities("root", depth), ready = new Set()
  const fixture = join(directory, "tree.mjs")
  const record = (name, suffix) => join(directory, name + suffix)
  // Every process handles termination and has a bounded fallback, so the
  // regression cleans up even when the original reporter crashes.
  writeFileSync(fixture, [
    'import { spawn, spawnSync } from "node:child_process"',
    'import { writeFileSync } from "node:fs"',
    'const name = process.argv[2], depth = Number(process.argv[3])',
    'const directory = ' + JSON.stringify(directory),
    'writeFileSync(directory + "/" + name + ".pid", String(process.pid))',
    'process.on("SIGTERM", () => {',
    '  writeFileSync(directory + "/" + name + ".signal", "SIGTERM"); process.exit(0)',
    '})',
    'process.stdout.on("error", () => {})',
    'if (depth) for (let i = 0; i < ' + width + '; i++) {',
    '  spawn(process.execPath, [import.meta.filename, name + i, String(depth - 1)], { stdio: "inherit" })',
    '}',
    'process.stdout.write("fixture-ready:" + name + "\\n")',
    'if (name === "root") setInterval(() => process.stdout.write(' +
      JSON.stringify("λ🦋".repeat(1024 + seed * 13) + "\n") + '), 5)',
    'setTimeout(() => {',
    '  writeFileSync(directory + "/" + name + ".signal", "escaped"); process.exit(0)',
    '}, 3000)',
  ].join("\n"))
  writeFileSync(join(directory, "go"),
    '#!/bin/sh\nexec "' + process.execPath + '" "' + fixture + '" root ' + depth + '\n', { mode: 0o700 })
  const observer = join(directory, "observer.mjs")
  writeFileSync(observer, [
    'const write = process.stdout.write.bind(process.stdout)',
    'let reported = false',
    'process.stdout.write = function (...args) {',
    '  const accepted = write(...args)',
    '  if (!accepted && !reported) { reported = true; process.stderr.write("fixture-output-full\\n") }',
    '  return accepted',
    '}',
  ].join("\n"))
  const child = spawn(process.execPath,
    ["--import", observer, script, "go", "test", "-json", "private-fixture-argument"],
    { env: { ...process.env, PATH: directory }, stdio: ["ignore", "pipe", "pipe"] })
  let stdout = "", stderr = "", disconnected = false
  const cut = () => { disconnected = true; child.stdout.destroy() }
  const deadline = setTimeout(() => { child.kill("SIGKILL"); child.stderr.destroy() }, 8000)
  t.after(() => {
    clearTimeout(deadline)
    try { process.kill(-Number(readFileSync(record("root", ".pid"), "utf8")), "SIGKILL") }
    catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) throw error }
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    rmSync(directory, { recursive: true, force: true })
  })
  child.stderr.on("data", bytes => {
    stderr += bytes
    if (paused && ready.size === expected.length && stderr.includes("fixture-output-full\n") && !disconnected) cut()
  })
  child.stdout.on("data", bytes => {
    stdout += bytes
    for (const match of stdout.matchAll(/fixture-ready:(root[01]*)\n/g)) ready.add(match[1])
    if (ready.size !== expected.length || disconnected) return
    if (!paused) cut()
    else {
      child.stdout.pause()
      if (stderr.includes("fixture-output-full\n")) cut()
    }
  })
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => resolve({ code, signal }))
  })
  assert.deepEqual([...ready].sort(), expected.sort(), "all owned processes must start before disconnect")
  assert.equal(disconnected, true, "the real output reader must close")
  assert.deepEqual(result, { code: 1, signal: null }, stderr)
  for (const name of expected) {
    assert.equal(readFileSync(record(name, ".signal"), "utf8"), "SIGTERM",
      "disconnected output must cancel " + name + " instead of leaving it running")
  }
  assert.match(stderr, /event=output-error.*cause=output code=EPIPE/)
  assert.match(stderr, /event=finish.*cause=output code=EPIPE/)
  assert.doesNotMatch(stderr, /Unhandled|private-fixture-argument|go-progress-output-/)
}

for (let seed = 1; seed <= 12; seed++) {
  for (const paused of [false, true]) {
    test("Go progress cancels its process tree when the " + (paused ? "paused " : "") +
      "output reader closes, seed " + seed,
    { timeout: 12000, skip: process.platform === "win32" },
    t => disconnect(t, seed, paused))
  }
}

test("Go progress cancels a native Go test's child when its output reader closes", {
  timeout: 600000, skip: process.platform === "win32"
}, async t => {
  const directory = mkdtempSync(join(tmpdir(), "go-progress-output-native-"))
  const receipt = join(directory, "receipt"), worker = join(directory, "worker.mjs")
  t.after(() => {
    try { process.kill(Number(readFileSync(receipt + ".pid", "utf8")), "SIGKILL") }
    catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) throw error }
    rmSync(directory, { recursive: true, force: true })
  })
  writeFileSync(worker, [
    'import { writeFileSync } from "node:fs"',
    'writeFileSync(' + JSON.stringify(receipt + ".pid") + ', String(process.pid))',
    'process.on("SIGTERM", () => { writeFileSync(' + JSON.stringify(receipt) + ', "SIGTERM"); process.exit(0) })',
    'process.stdout.on("error", () => {})',
    'process.stdout.write("native-output-ready\\n")',
    'setInterval(() => process.stdout.write("output ".repeat(8192)), 10)',
    'setTimeout(() => { writeFileSync(' + JSON.stringify(receipt) + ', "escaped"); process.exit(0) }, 3000)',
  ].join("\n"))
  writeFileSync(join(directory, "go.mod"), "module progress.output.fixture\n\ngo 1.27\n")
  writeFileSync(join(directory, "output_test.go"), [
    'package progress',
    'import ("os"; "os/exec"; "testing")',
    'func TestOutput(t *testing.T) {',
    '  child := exec.Command(os.Getenv("PROGRESS_NODE"), os.Getenv("PROGRESS_WORKER"))',
    '  child.Stdout, child.Stderr = os.Stdout, os.Stderr',
    '  if err := child.Run(); err != nil { t.Fatal(err) }',
    '}',
  ].join("\n"))
  const goroot = spawnSync("go", ["env", "GOROOT"], { encoding: "utf8" })
  assert.equal(goroot.status, 0, goroot.stderr)
  const child = spawn(process.execPath, [script, "go", "test", "-json", "-count=1", "-p", "8", "."], {
    cwd: directory, env: { ...process.env, GOFLAGS: "", GOWORK: "off", GOMAXPROCS: "8",
      PATH: join(goroot.stdout.trim(), "bin") + delimiter + process.env.PATH,
      PROGRESS_NODE: process.execPath, PROGRESS_WORKER: worker },
    stdio: ["ignore", "pipe", "pipe"],
  })
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM") })
  let stdout = "", stderr = "", disconnected = false
  child.stderr.on("data", bytes => { stderr += bytes })
  child.stdout.on("data", bytes => {
    stdout += bytes
    if (!disconnected && stdout.includes("native-output-ready")) {
      disconnected = true
      child.stdout.destroy()
    }
  })
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => resolve({ code, signal }))
  })
  assert.equal(disconnected, true, stdout + stderr)
  assert.deepEqual(result, { code: 1, signal: null }, stderr)
  assert.equal(readFileSync(receipt, "utf8"), "SIGTERM", "the native test's child must be cancelled")
  assert.match(stderr, /event=output-error.*cause=output code=EPIPE/)
  assert.match(stderr, /event=finish.*cause=output code=EPIPE/)
  assert.doesNotMatch(stderr, /Unhandled|PROGRESS_NODE|PROGRESS_WORKER|go-progress-output-native-/)
})
