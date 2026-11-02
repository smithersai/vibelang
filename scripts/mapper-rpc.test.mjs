import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"
import { client } from "../packages/ts-mapper/test/protocol-client.mjs"
import { checkProperty } from "./testing/property.mjs"

const require = createRequire(new URL("../packages/compiler/package.json", import.meta.url))
const fc = require("fast-check")
const secret = "MALFORMED_RESPONSE_PRIVATE_SENTINEL"
const peer = String.raw`
import { closeSync } from "node:fs"
const [mode, settings] = process.argv.slice(1)
const options = JSON.parse(settings)
let input = Buffer.alloc(0), requests = []
setInterval(() => {}, 1000)
if (options.ignoreTerm) process.on("SIGTERM", () => {})
const frame = message => {
  const body = Buffer.from(JSON.stringify(message))
  return Buffer.concat([Buffer.from("Content-Length: " + body.length + "\r\n\r\n"), body])
}
let writes = Promise.resolve()
function write(bytes) {
  writes = writes.then(async () => {
    for (let at = 0; at < bytes.length; at += options.chunk || bytes.length) {
      await new Promise((resolve, reject) => process.stdout.write(bytes.subarray(at, at + (options.chunk || bytes.length)), error => error ? reject(error) : setImmediate(resolve)))
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
    if (message.method === "ready") { write(frame({ id: message.id, result: process.pid })); continue }
    if (!message.method) {
      if (message.id === "configuration") write(frame({ id: requests[0].id, result: message.result }))
      continue
    }
    requests.push(message)
    if (requests.length !== options.count) continue
    if (mode === "valid") {
      const replies = [...requests].reverse().map(r => frame({ id: r.id, result: r.params }))
      write(Buffer.concat(replies))
    } else if (mode === "response-error") {
      write(frame({ id: message.id, error: { code: -32603, message: "expected fixture rejection" } }))
      requests = []
    } else if (mode === "configuration") {
      write(frame({ id: "configuration", method: "workspace/configuration", params: { items: [{ section: "a" }, { section: "b" }] } }))
    } else if (mode.endsWith("eof")) {
      const bytes = mode === "header-eof" ? "Content-Len" : mode === "body-eof" ? "Content-Length: 100\r\n\r\n{" : ""
      writes = writes.then(() => {
        if (bytes) process.stdout.write(bytes, () => closeSync(1))
        else closeSync(1)
      })
    } else if (mode === "exit") process.exit(23)
    else if (mode === "signal") process.kill(process.pid, "SIGKILL")
    else if (mode === "missing-length") write(Buffer.from("X-Fixture: private\r\n\r\n{}"))
    else if (mode === "duplicate-length") write(Buffer.from("Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}"))
    else if (mode === "invalid-length") write(Buffer.from("Content-Length: 2junk\r\n\r\n{}"))
    else if (mode === "oversized-length") write(Buffer.from("Content-Length: 8388609\r\n\r\n"))
    else if (mode === "unsafe-length") write(Buffer.from("Content-Length: 9007199254740992\r\n\r\n"))
    else if (mode === "json") {
      const body = '{"private":"MALFORMED_RESPONSE_PRIVATE_SENTINEL", BROKEN'
      write(Buffer.from("Content-Length: " + Buffer.byteLength(body) + "\r\n\r\n" + body))
    } else if (mode === "null") write(frame(null))
    else if (mode === "array") write(frame([]))
    else if (mode === "server-request") write(frame({ id: "configuration", method: "workspace/configuration", params: { private: "MALFORMED_RESPONSE_PRIVATE_SENTINEL" } }))
  }
})
`

// The safety guard is failure evidence, never a passing latency threshold.
async function bounded(promise, stage) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("emergency guard: " + stage)), 5000)
    })])
  } finally { clearTimeout(timer) }
}

async function fixture(t, mode, options = {}) {
  const rpc = client(process.execPath, ["--input-type=module", "-e", peer, mode, JSON.stringify({ count: 3, ...options })], process.cwd())
  t.after(() => rpc.close())
  const pid = await bounded(rpc.request("ready"), "peer startup")
  return { rpc, pid }
}

for (const [mode, stage] of [
  ["eof", "stdout closed"], ["header-eof", "stdout closed"], ["body-eof", "stdout closed"],
  ["missing-length", "headers"], ["duplicate-length", "headers"], ["invalid-length", "headers"],
  ["oversized-length", "headers"], ["unsafe-length", "headers"], ["json", "body"],
  ["null", "dispatch"], ["array", "dispatch"], ["server-request", "dispatch"],
  ["exit", "exited|stdout closed"], ["signal", "exited|stdout closed"]
]) {
  test("mapper RPC rejects every request after " + mode, async t => {
    const { rpc, pid } = await fixture(t, mode, { ignoreTerm: mode === "body-eof" })
    const methods = ["initialize", "textDocument/hover", "textDocument/diagnostic"]
    const results = await bounded(Promise.allSettled(methods.map(method => rpc.request(method))), "pending responses")
    for (let i = 0; i < results.length; i++) {
      assert.equal(results[i].status, "rejected")
      const message = results[i].reason.message
      assert.ok(message.includes(methods[i]), message)
      assert.match(message, /request \d+/)
      assert.match(message, new RegExp(stage))
      assert.ok(!message.includes(secret), message)
    }
    await assert.rejects(bounded(rpc.request("afterFailure"), "future response"), error => {
      assert.match(error.message, /afterFailure/)
      assert.match(error.message, new RegExp(stage))
      return true
    })
    assert.throws(() => rpc.notify("afterFailure"), new RegExp(stage))
    await Promise.all([rpc.close(), rpc.close()])
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
  })
}

test("closing mapper RPC rejects pending and future work and reaps an unresponsive peer", async t => {
  const { rpc, pid } = await fixture(t, "waiting", { ignoreTerm: true })
  const pending = Promise.allSettled([rpc.request("waiting")])
  await bounded(Promise.all([rpc.close(), rpc.close()]), "close")
  const [result] = await bounded(pending, "close rejection")
  assert.equal(result.status, "rejected")
  assert.match(result.reason.message, /waiting.*client closed/)
  await assert.rejects(rpc.request("closed"), /closed.*client closed/)
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
})

test("mapper RPC preserves response errors without failing the transport", async t => {
  const { rpc } = await fixture(t, "response-error", { count: 1 })
  await assert.rejects(rpc.request("first"), /first.*expected fixture rejection/)
  await assert.rejects(rpc.request("second"), /second.*expected fixture rejection/)
  assert.equal(typeof await bounded(rpc.request("ready"), "still usable"), "number")
})

test("mapper RPC answers server configuration requests", async t => {
  const { rpc } = await fixture(t, "configuration", { count: 1, chunk: 1 })
  assert.deepEqual(await bounded(rpc.request("configuration"), "server configuration"), [null, null])
})

test("mapper RPC preserves Unicode results across fragmented and coalesced frames", async t => {
  await checkProperty(fc, {
    name: "mapper-rpc-framing", rule: "Test transport invariant: framing preserves JSON results and request ids across arbitrary stdout chunk boundaries; response order is independent of request order.",
    command: "node --test scripts/mapper-rpc.test.mjs",
    arbitrary: fc.record({
      chunk: fc.integer({ min: 1, max: 512 }),
      values: fc.array(fc.string({ unit: "grapheme", maxLength: 30 }), { minLength: 1, maxLength: 5 })
    }),
    numRuns: 40,
    check: async ({ chunk, values }) => {
      const { rpc, pid } = await fixture(t, "valid", { count: values.length, chunk })
      try {
        const valuesWithUnicode = values.map(value => ({ value: value + "雪😀café" }))
        assert.deepEqual(await bounded(Promise.all(valuesWithUnicode.map(value => rpc.request("echo", value))), "valid replies"), valuesWithUnicode)
      } finally { await rpc.close() }
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
    }
  })
})

test("mapper RPC reports spawn failure to pending and future requests", async t => {
  const rpc = client(process.execPath + ".vibelang-nonexistent", [], process.cwd())
  t.after(() => rpc.close())
  await assert.rejects(bounded(rpc.request("initialize"), "spawn failure"), /initialize.*spawn failed \(ENOENT\)/)
  await assert.rejects(bounded(rpc.request("future"), "future spawn failure"), /future.*spawn failed \(ENOENT\)/)
  assert.throws(() => rpc.notify("future"), /spawn failed \(ENOENT\)/)
  await bounded(Promise.all([rpc.close(), rpc.close()]), "failed spawn cleanup")
})

test("mapper RPC decodes Unicode split at every byte in reversed coalesced replies", async t => {
  const { rpc } = await fixture(t, "valid", { count: 3, chunk: 1 })
  const values = ["雪", "😀", "café"]
  assert.deepEqual(await bounded(Promise.all(values.map(value => rpc.request("echo", value))), "Unicode replies"), values)
})
