import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { constants, tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const script = fileURLToPath(new URL("./go-test-progress.mjs", import.meta.url))

// Observe the real stdout pipe, leaving its writes and drain events intact.
// Node resumes a child's stdio streams in the turn after the child exits, so
// "go-exited" arrives after any output that resumption would forward.
const observerSource = `
import { ChildProcess } from "node:child_process"
const emit = ChildProcess.prototype.emit
ChildProcess.prototype.emit = function (name, ...args) {
  if (name === "exit") setTimeout(() => process.stderr.write("go-exited\\n"), 100)
  return emit.call(this, name, ...args)
}
const write = process.stdout.write.bind(process.stdout)
let blocked = false, violations = 0, peak = 0, saturated = false
process.stdout.on("drain", () => { blocked = false })
process.stdout.write = function (...args) {
  if (blocked) violations++
  const accepted = write(...args)
  peak = Math.max(peak, process.stdout.writableLength)
  if (!accepted) {
    blocked = true
    if (!saturated) {
      saturated = true
      process.stderr.write("pipe-saturated\\n")
    }
  }
  return accepted
}
process.once("beforeExit", () => process.stderr.write(
  "pipe-receipt " + JSON.stringify({ violations, peak, saturated }) + "\\n"))
`

async function slowPipe(t, { seed, size, status, signal }) {
  const directory = mkdtempSync(join(tmpdir(), "go-progress-pipe-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const record = item => JSON.stringify(item) + "\n"
  const prefix = record({ Action: "start", Package: "fixture" }) +
    record({ Action: "run", Package: "fixture", Test: "TestPipe" })
  const output = record({ Action: "output", Output: "λ🦋".repeat(4096 + seed % 127) })
  const count = Math.ceil(size / Buffer.byteLength(output))
  const suffix = record({ Action: status ? "fail" : "pass", Package: "fixture", Test: "TestPipe" }) +
    record({ Action: status ? "fail" : "pass", Package: "fixture" })
  const expected = createHash("sha256").update(prefix)
  for (let i = 0; i < count; i++) expected.update(output)
  expected.update(suffix)
  const producer = join(directory, "producer.mjs")
  writeFileSync(producer, `
import { once } from "node:events"
const prefix = Buffer.from(${JSON.stringify(prefix)})
const output = Buffer.from(${JSON.stringify(output)})
const suffix = Buffer.from(${JSON.stringify(suffix)})
${signal ? 'process.on(' + JSON.stringify(signal) + ', () => process.stderr.write("producer-received ' + signal + '\\n"))' : ""}
let random = ${seed}
for (const bytes of [prefix, ...Array(${count}).fill(output), suffix]) {
  for (let offset = 0; offset < bytes.length;) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0
    const width = 1 + random % 65536
    const next = bytes.subarray(offset, offset + width)
    offset += next.length
    if (!process.stdout.write(next)) await once(process.stdout, "drain")
  }
}
process.exitCode = ${status}
`)
  writeFileSync(join(directory, "go"),
    '#!/bin/sh\nexec "' + process.execPath + '" "' + producer + '"\n', { mode: 0o700 })
  const observer = join(directory, "observer.mjs")
  writeFileSync(observer, observerSource)
  const child = spawn(process.execPath,
    ["--import", observer, script, "go", "test", "-json"],
    { env: { ...process.env, PATH: directory }, stdio: ["ignore", "pipe", "pipe"] })
  let stderr = "", bytes = 0, draining = false, signaled = false, drainTimer
  const actual = createHash("sha256")
  const drain = () => {
    if (draining) return
    draining = true
    child.stdout.on("data", chunk => { bytes += chunk.length; actual.update(chunk) })
  }
  // Hold the actual pipe until it fills, then resume its consumer. The
  // assertion is the write/drain contract, independent of elapsed time.
  const fallback = setTimeout(drain, 5000)
  const deadline = setTimeout(() => child.kill("SIGKILL"), 20000)
  t.after(() => {
    clearTimeout(fallback); clearTimeout(deadline); clearTimeout(drainTimer)
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  })
  child.stderr.on("data", chunk => {
    stderr += chunk
    if (!draining && !drainTimer && stderr.includes("pipe-saturated\n")) {
      if (signal && !signaled) { signaled = true; child.kill(signal) }
      drainTimer = setTimeout(drain, 150)
    }
  })
  const closed = await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => resolve({ code, signal }))
  })
  clearTimeout(fallback); clearTimeout(deadline); clearTimeout(drainTimer)
  assert.deepEqual(closed, { code: signal ? 128 + constants.signals[signal] : status, signal: null }, stderr)
  assert.equal(bytes, Buffer.byteLength(prefix) + count * Buffer.byteLength(output) + Buffer.byteLength(suffix))
  assert.equal(actual.digest("hex"), expected.digest("hex"), "forwarded bytes changed")
  const receipt = /pipe-receipt (.+)/.exec(stderr)
  assert.ok(receipt, stderr)
  const observed = JSON.parse(receipt[1])
  assert.equal(observed.saturated, true, "the consumer must exercise backpressure")
  assert.equal(observed.violations, 0, "writes continued before the pipe drained: " + receipt[1])
  assert.ok(observed.peak <= 128 * 1024, "queued stdout grew beyond two pipe chunks: " + receipt[1])
  assert.match(stderr, /event=finish.*packages_finished=1.*tests_finished=1/)
  if (signal) {
    assert.equal(signaled, true)
    assert.match(stderr, new RegExp("producer-received " + signal))
    assert.match(stderr, new RegExp("event=cancel.*signal=" + signal))
    assert.match(stderr, new RegExp("event=finish.*cause=signal.*signal=" + signal))
  } else assert.match(stderr, /event=finish.*cause=exit/)
  if (status) assert.match(stderr, /--- FAIL: TestPipe \(go-failure/)
  else assert.doesNotMatch(stderr, /--- FAIL:|go-failure-summary/)
}

test("Go progress bounds queued output while a real pipe consumer pauses",
  { timeout: 30000, skip: process.platform === "win32" },
  t => slowPipe(t, { seed: 6201, size: 32 * 1024 * 1024, status: 0 }))

for (let seed = 1; seed <= 12; seed++) {
  test("Go progress preserves fragmented Unicode output and exit status through a slow pipe, seed " + seed,
    { timeout: 30000, skip: process.platform === "win32" },
    t => slowPipe(t, { seed, size: 2 * 1024 * 1024, status: [0, 1, 7][seed % 3] }))
}

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  test("Go progress forwards " + signal + " while its output pipe is paused",
    { timeout: 30000, skip: process.platform === "win32" },
    t => slowPipe(t, { seed: 27, size: 2 * 1024 * 1024, status: 0, signal }))
}

test("Go progress keeps backpressure when Go exits while its output pipe is paused",
  { timeout: 30000, skip: process.platform === "win32" }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "go-progress-exit-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const stop = join(directory, "stop")
  const producer = join(directory, "producer.mjs")
  // Write until the consumer saturates, then exit with output still unread.
  writeFileSync(producer, `
import { existsSync } from "node:fs"
import { once } from "node:events"
setInterval(() => { if (existsSync(${JSON.stringify(stop)})) process.exit(0) }, 5)
const line = Buffer.from(JSON.stringify({ Action: "output", Output: "x".repeat(1000) }) + "\\n")
for (;;) if (!process.stdout.write(line)) await once(process.stdout, "drain")
`)
  writeFileSync(join(directory, "go"),
    '#!/bin/sh\nexec "' + process.execPath + '" "' + producer + '"\n', { mode: 0o700 })
  const observer = join(directory, "observer.mjs")
  writeFileSync(observer, observerSource)
  const child = spawn(process.execPath,
    ["--import", observer, script, "go", "test", "-json"],
    { env: { ...process.env, PATH: directory }, stdio: ["ignore", "pipe", "pipe"] })
  let stderr = "", drainedAfterExit = false, draining = false
  const drain = () => {
    if (draining) return
    draining = true
    child.stdout.on("data", () => {})
  }
  const fallback = setTimeout(drain, 15000)
  t.after(() => {
    clearTimeout(fallback)
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  })
  child.stderr.on("data", chunk => {
    stderr += chunk
    if (stderr.includes("pipe-saturated\n") && !existsSync(stop)) writeFileSync(stop, "")
    if (!draining && stderr.includes("go-exited\n")) { drainedAfterExit = true; drain() }
  })
  const closed = await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => resolve({ code, signal }))
  })
  clearTimeout(fallback)
  assert.equal(drainedAfterExit, true, "Go must exit while the output pipe is paused: " + stderr)
  assert.deepEqual(closed, { code: 0, signal: null }, stderr)
  const receipt = /pipe-receipt (.+)/.exec(stderr)
  assert.ok(receipt, stderr)
  const observed = JSON.parse(receipt[1])
  assert.equal(observed.saturated, true, "the consumer must exercise backpressure")
  assert.equal(observed.violations, 0, "writes continued before the pipe drained: " + receipt[1])
  assert.match(stderr, /event=finish.*cause=exit/)
})
