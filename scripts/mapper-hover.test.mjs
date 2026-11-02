import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { checkProperty } from "./testing/property.mjs"

const require = createRequire(new URL("../packages/compiler/package.json", import.meta.url))
const fc = require("fast-check")

const runner = fileURLToPath(new URL("../packages/ts-mapper/test/lsp-hover.mjs", import.meta.url))
const fixture = new URL("../packages/ts-mapper/test/fixture/src/greet.vibe", import.meta.url)

const modes = [
  "success", "success-ignore-exit", "success-ignore-term", "hover-mismatch",
  "initialize-error", "hover-error", "diagnostic-error", "shutdown-error",
  "initialize-exit", "malformed-header", "malformed-json", "configuration"
]

async function checkPeer(t, mode, { chunk = 0, noise = 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), "vibelang mapper hover-"))
  let pid
  const cleanup = () => {
    if (pid) { try { process.kill(pid, "SIGKILL") } catch {}; pid = undefined }
    rmSync(root, { recursive: true, force: true })
  }
  t.after(cleanup)
  try {
    const project = join(root, "project with spaces")
    mkdirSync(join(project, "src"), { recursive: true })
    copyFileSync(fixture, join(project, "src/greet.vibe"))
    const server = join(root, "peer")
    const pidFile = join(root, "pid")
    const trace = join(root, "calls")
    writeFileSync(server, "#!" + process.execPath + "\n" + String.raw`
  import { appendFileSync, writeFileSync } from "node:fs"
  const mode = process.env.MAPPER_HOVER_MODE
  writeFileSync(process.env.MAPPER_HOVER_PID, String(process.pid))
  setInterval(() => {}, 1000)
  if (mode !== "success" && mode !== "configuration" && mode !== "success-ignore-exit") process.on("SIGTERM", () => {})
  process.stderr.write("x".repeat(Number(process.env.MAPPER_HOVER_NOISE || 0)))
  let input = Buffer.alloc(0), init
  let writes = Promise.resolve()
  const send = message => {
  const body = JSON.stringify(message)
  const bytes = Buffer.from("Content-Length: " + Buffer.byteLength(body) + "\r\n\r\n" + body)
  const chunkSize = Number(process.env.MAPPER_HOVER_CHUNK) || Math.ceil(bytes.length / 2)
  writes = writes.then(async () => {
    for (let start = 0; start < bytes.length; start += chunkSize) {
      await new Promise((resolve, reject) => process.stdout.write(bytes.subarray(start, start + chunkSize), error => error ? reject(error) : setImmediate(resolve)))
    }
  })
  }
  process.stdin.on("data", chunk => {
  input = Buffer.concat([input, chunk])
  for (;;) {
    const end = input.indexOf("\r\n\r\n")
    if (end < 0) return
    const length = Number(/Content-Length: (\d+)/.exec(input.subarray(0, end).toString())[1])
    if (input.length < end + 4 + length) return
    const message = JSON.parse(input.subarray(end + 4, end + 4 + length))
    input = input.subarray(end + 4 + length)
    appendFileSync(process.env.MAPPER_HOVER_TRACE, JSON.stringify(message) + "\n")
    if (!message.method) {
      if (message.id === "settings") send({ id: init.id, result: { capabilities: {} } })
      continue
    }
    if (message.method === "exit") {
      if (mode === "success" || mode === "configuration") process.exit(0)
      continue
    }
    if (message.id === undefined) continue
    if (message.method === "initialize" && mode === "initialize-exit") process.exit(23)
    if (message.method === "initialize" && mode === "malformed-header") { process.stdout.write("Invalid: frame\r\n\r\n{}"); continue }
    if (message.method === "initialize" && mode === "malformed-json") { process.stdout.write("Content-Length: 1\r\n\r\n{"); continue }
    if (message.method === "initialize" && mode === "configuration") {
      init = message
      send({ id: "settings", method: "workspace/configuration", params: { items: [{ section: "compiler" }] } })
      continue
    }
    const failAt = { "initialize-error": "initialize", "hover-error": "textDocument/hover", "diagnostic-error": "textDocument/diagnostic", "shutdown-error": "shutdown" }[mode]
    if (message.method === failAt) {
      send({ id: message.id, error: { code: -32603, message: "fixture " + message.method + " failed" } })
      continue
    }
    const result = message.method === "initialize" ? { capabilities: {} } :
      message.method === "textDocument/hover" ? { contents: { value: mode === "hover-mismatch" ? "wrong hover" : 'function greet(name: string): Effect.Effect<string, EmptyName, never>\nconst loud: string\nfunction shout(text: string): Effect.Effect<string, never, never>\n雪😀' } } :
      message.method === "textDocument/diagnostic" ? { items: [{ severity: 1, code: 2322, range: { start: { line: 10, character: 8 } }, message: "Type 'string' is not assignable to type 'number'." }] } : null
    send({ id: message.id, result })
  }
  })
  `)
    chmodSync(server, 0o755)
    const result = spawnSync(process.execPath, [runner, server, project], {
      env: { ...process.env, MAPPER_HOVER_MODE: mode, MAPPER_HOVER_PID: pidFile, MAPPER_HOVER_TRACE: trace, MAPPER_HOVER_CHUNK: String(chunk), MAPPER_HOVER_NOISE: String(noise) },
      encoding: "utf8", timeout: 8000, killSignal: "SIGKILL"
    })
    pid = Number(readFileSync(pidFile, "utf8"))
    assert.equal(result.error, undefined, result.stderr)
    const alive = () => { try { process.kill(pid, 0); return true } catch { return false } }
    // Allow init to reap a peer if the old runner died first. This is a guard,
    // not a passing speed threshold; the new runner awaits its own child.
    for (let i = 0; i < 20 && alive(); i++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(alive(), false, "hover runner left its peer alive")
    pid = undefined
    const calls = readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line))
    assert.equal(calls[0].method, "initialize")
    const passing = mode.startsWith("success") || mode === "configuration"
    assert.equal(result.status, passing ? 0 : 1, result.stdout + result.stderr)
    if (passing || mode === "hover-mismatch") {
      assert.equal(calls.filter(call => call.method === "textDocument/hover").length, 3)
      assert.equal(calls.filter(call => call.method === "textDocument/diagnostic").length, 1)
      assert.ok(calls.some(call => call.method === "shutdown"))
      if (passing) assert.doesNotMatch(result.stdout + result.stderr, /FAIL|check\(s\) failed/)
    } else {
      assert.match(result.stderr, /lsp-hover:/)
      if (mode.endsWith("-error")) assert.match(result.stderr, /fixture .* failed/)
    }
    if (mode === "configuration") assert.deepEqual(calls.find(call => call.id === "settings").result, [null])
  } finally { cleanup() }
}

for (const mode of modes) test("mapper hover runner reaps its peer: " + mode, t => checkPeer(t, mode))

test("mapper hover runner reports a missing peer without an unhandled event", () => {
  const project = fileURLToPath(new URL("../packages/ts-mapper/test/fixture", import.meta.url))
  const result = spawnSync(process.execPath, [runner, process.execPath + ".vibelang-nonexistent", project], { encoding: "utf8", timeout: 8000 })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /lsp-hover:.*ENOENT/)
  assert.doesNotMatch(result.stderr, /Unhandled 'error' event/)
})

test("mapper hover runner tolerates fragmented Unicode replies and stderr pressure", async t => {
  await checkProperty(fc, {
    name: "mapper-hover-streaming",
    rule: "Runner invariant: valid replies keep hover/diagnostic checks and exit status stable across stdout chunk boundaries and unrelated server stderr; every run reaps its peer.",
    command: "node --test scripts/mapper-hover.test.mjs",
    arbitrary: fc.record({ chunk: fc.integer({ min: 1, max: 1024 }), noise: fc.integer({ min: 0, max: 131072 }) }),
    numRuns: 30,
    check: options => checkPeer(t, "success-ignore-exit", options)
  })
})
