import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { Connection } from "../typescript/vibelang/lsp-connection.mjs"

// Real processes and pipes exercise exit/close ordering, spawn errors and EPIPE.
const peer = String.raw`
let buffer = Buffer.alloc(0)
const mode = process.argv[2]
setInterval(() => {}, 10_000)
const send = (message) => {
  const body = Buffer.from(JSON.stringify(message))
  const frame = Buffer.concat([Buffer.from("Content-Length: " + body.length + "\r\n\r\n"), body])
  if (mode === "fragment") {
    process.stdout.write(frame.subarray(0, 9))
    setImmediate(() => process.stdout.write(frame.subarray(9)))
  } else process.stdout.write(frame)
}
if (mode === "exit-idle") setImmediate(() => process.exit(19))
process.stdin.on("end", () => { if (mode !== "shutdown-hang") process.exit(0) })
process.stdin.on("data", chunk => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const end = buffer.indexOf("\r\n\r\n")
    if (end < 0) return
    const length = Number(/Content-Length: *(\d+)/i.exec(buffer.subarray(0, end).toString())[1])
    if (buffer.length < end + 4 + length) return
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString())
    buffer = buffer.subarray(end + 4 + length)
    if (message.method === "exit") process.exit(0)
    if (message.id === undefined) continue
    if (mode === "exit") { console.error("fixture peer stopped"); process.exit(23) }
    if (mode === "signal") process.kill(process.pid, "SIGTERM")
    else if (mode === "hang" || mode === "shutdown-hang" && message.method === "shutdown") continue
    else if (message.method === "reject") send({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: "fixture refusal" } })
    else send({ jsonrpc: "2.0", id: message.id, result: message.params ?? null })
  }
})
`

function connection(t, mode, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-lsp-connection-"))
  const file = join(dir, "peer.mjs")
  writeFileSync(file, peer)
  const c = mode === "missing"
    ? new Connection(join(dir, "missing-server"), [], dir, options)
    : new Connection(process.execPath, [file, mode], dir, options)
  t.after(async () => {
    // Also clean up the intentionally failing baseline implementation's timers.
    for (const waiter of c.pending.values()) waiter.reject(new Error("fixture teardown"))
    c.pending.clear()
    if (c.process.pid && c.process.exitCode === null && c.process.signalCode === null) {
      c.process.kill("SIGKILL")
      await c.exited
    }
    rmSync(dir, { recursive: true, force: true })
  })
  return c
}

async function promptly(promise) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("transport did not settle within 5 seconds")), 5_000)
    })])
  } finally { clearTimeout(timer) }
}

for (const mode of ["reply", "fragment"]) test("LSP round trip retains UTF-8 framing: " + mode, async t => {
  const c = connection(t, mode)
  assert.deepEqual(await promptly(c.request("hover", { value: "café 🐈" })), { value: "café 🐈" })
  assert.equal(c.pending.size, 0)
  assert.deepEqual(await promptly(c.close()), { code: 0, signal: null })
})

for (const [mode, cause] of [["exit", /23/], ["signal", /SIGTERM/]]) {
  test("LSP " + mode + " rejects every pending request with its identity and cause", async t => {
    const c = connection(t, mode)
    const methods = ["hover", "diagnostic", "definition"]
    const results = await promptly(Promise.allSettled(methods.map(method => c.request(method, {}))))
    for (const [i, result] of results.entries()) {
      assert.equal(result.status, "rejected")
      assert.match(result.reason.message, new RegExp(methods[i]))
      assert.match(result.reason.message, new RegExp("#" + (i + 1)))
      assert.match(result.reason.message, cause)
    }
    assert.equal(c.pending.size, 0)
    if (mode === "exit") assert.match(c.log.join("\n"), /fixture peer stopped/)
  })
}

test("LSP spawn failure rejects requests and close completes", async t => {
  const c = connection(t, "missing")
  await assert.rejects(promptly(c.request("initialize", {})), /ENOENT/)
  assert.equal(c.pending.size, 0)
  const exit = await promptly(c.close())
  assert.notEqual(exit.code, 0)
})

test("LSP requests after exit fail promptly without writing to a closed pipe", async t => {
  const c = connection(t, "exit-idle")
  await promptly(c.exited)
  await assert.rejects(promptly(c.request("hover", {})), /hover.*19/)
  assert.equal(c.pending.size, 0)
  assert.deepEqual(await promptly(c.close()), { code: 19, signal: null })
})

test("LSP request deadlines remove waiters and identify the timed out request", async t => {
  const c = connection(t, "hang", { requestTimeoutMs: 50 })
  await assert.rejects(promptly(c.request("diagnostic", {})), /diagnostic.*#1.*50 ms/)
  assert.equal(c.pending.size, 0)
})

test("LSP shutdown remains bounded when the peer ignores shutdown and EOF", async t => {
  const c = connection(t, "shutdown-hang", { requestTimeoutMs: 1_000, shutdownTimeoutMs: 50 })
  await promptly(c.request("initialize", {}))
  assert.deepEqual(await promptly(c.close()), { code: null, signal: "SIGKILL" })
  assert.equal(c.pending.size, 0)
})

test("LSP protocol errors clear only their own waiter and allow later requests", async t => {
  const c = connection(t, "reply")
  const results = await promptly(Promise.allSettled([c.request("reject", {}), c.request("hover", { value: 42 })]))
  assert.equal(results[0].status, "rejected")
  assert.match(results[0].reason.message, /reject.*fixture refusal/)
  assert.deepEqual(results[1], { status: "fulfilled", value: { value: 42 } })
  assert.equal(c.pending.size, 0)
  assert.deepEqual(await promptly(c.close()), { code: 0, signal: null })
})
