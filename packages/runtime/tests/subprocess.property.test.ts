import { expect, test } from "bun:test"
import fc from "fast-check"
import { observeChild } from "./subprocess"

test("runtime child failures retain timeout evidence without output or command payloads", () => {
  fc.assert(fc.property(fc.string(), fc.string(), fc.boolean(), fc.constantFrom("SIGTERM", "SIGKILL", "SIGINT"), (stdout, stderr, timeoutReported, signalCode) => {
    const records: string[] = []
    const result = { exitCode: null, signalCode, exitedDueToTimeout: timeoutReported, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) }
    let tick = 10
    expect(observeChild("Node", () => result, { now: () => tick += 3, timeoutMs: 50, report: record => records.push(record) })).toBe(result)
    expect(records).toHaveLength(1)
    expect(JSON.parse(records[0].slice("[runtime-child] ".length))).toEqual({
      host: "Node", elapsedMs: 3, explicitTimeoutMs: 50, stage: "child-exit",
      exitCode: null, timeoutReported, signal: signalCode,
      stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr)
    })
  }), { seed: 240024, numRuns: 100 })
})

test("runtime child observations preserve every numeric exit without emitting noise", () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 255 }), exitCode => {
    const records: string[] = []
    const result = { exitCode, stdout: Buffer.from("private output"), stderr: Buffer.from("private error") }
    expect(observeChild("Bun", () => result, { report: record => records.push(record) })).toBe(result)
    expect(records).toEqual([])
  }), { seed: 240025, numRuns: 100 })
})

test("runtime child spawn errors retain identity and redact untrusted fields", () => {
  fc.assert(fc.property(fc.string(), fc.string(), (message, secret) => {
    const error = Object.assign(new Error(message), { code: secret, command: secret, path: secret })
    const records: string[] = []
    let caught: unknown
    try { observeChild("Node", () => { throw error }, { now: () => 1, report: record => records.push(record) }) }
    catch (actual) { caught = actual }
    expect(caught).toBe(error)
    const record = JSON.parse(records[0].slice("[runtime-child] ".length))
    expect(Object.keys(record).sort()).toEqual(["elapsedMs", "errorCode", "explicitTimeoutMs", "host", "stage"])
    expect(record.errorCode).toBe(["EACCES", "EAGAIN", "ENOENT", "ENOBUFS", "ETIMEDOUT"].includes(secret) ? secret : null)
  }), { seed: 240026, numRuns: 100 })
})

test("runtime main timeout includes bounded child evidence", () => {
  const { mkdtempSync, writeFileSync, rmSync } = require("node:fs") as typeof import("node:fs")
  const { tmpdir } = require("node:os") as typeof import("node:os")
  const { join, delimiter } = require("node:path") as typeof import("node:path")
  const directory = mkdtempSync(join(tmpdir(), "runtime-child-evidence-"))
  try {
    const node = Bun.which("node")
    if (!node) throw new Error("Node is required for the runtime main timeout regression")
    const quotedNode = "'" + node.replaceAll("'", "'\\''") + "'"
    writeFileSync(join(directory, "node"), "#!/bin/sh\nexec " + quotedNode + " -e 'setTimeout(() => {}, 3000)'\n", { mode: 0o755 })
    // Inject at the child-process boundary. A test's explicit timeout overrides
    // Bun's CLI default, so a short --timeout cannot reliably kill this child.
    const preload = join(directory, "force-child-timeout.mjs")
    writeFileSync(preload, 'const spawn = Bun.spawnSync.bind(Bun); Bun.spawnSync = (args, options) => Array.isArray(args) && args[0] === "node" ? spawn(args, { ...options, timeout: 200 }) : spawn(args, options);\n')
    const child = Bun.spawnSync([
      process.execPath, "test", "--timeout", "10000", "--preload", preload,
      "--test-name-pattern", "^main reports typed error fields on Node$",
      import.meta.dir + "/main.test.ts"
    ], {
      cwd: import.meta.dir + "/..", timeout: 15_000,
      env: { ...process.env, PATH: directory + delimiter + process.env.PATH }
    })
    expect(child.exitedDueToTimeout).toBe(false)
    expect(child.exitCode).toBe(1)
    const output = child.stderr.toString()
    const line = output.split("\n").find(line => line.startsWith("[runtime-child] "))
    expect(line, "main must explain a killed child before its exit-code assertion fails").toBeDefined()
    const record = JSON.parse(line!.slice("[runtime-child] ".length))
    expect(record).toMatchObject({
      host: "Node", stage: "child-exit",
      exitCode: null, signal: "SIGTERM", explicitTimeoutMs: null,
      stdoutBytes: 0, stderrBytes: 0
    })
    expect(typeof record.timeoutReported).toBe("boolean")
    expect(record.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(record.elapsedMs).toBeLessThan(15_000)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 20_000)
