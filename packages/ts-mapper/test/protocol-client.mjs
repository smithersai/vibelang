// Bounded JSON-RPC transport shared by the real mapper and stock TypeScript LSP.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { pathToFileURL } from "node:url"

export function client(binary, args, cwd) {
  const child = spawn(binary, args, { cwd, stdio: ["pipe", "pipe", "pipe"] })
  const closed = new Promise(resolve => child.once("close", resolve))
  let buffer = Buffer.alloc(0), stderr = "", nextId = 0, stopped = false
  let failure, closing
  const pending = new Map()
  const log = () => `${binary}: pending ${[...pending.values()].map(p => p.method).join(", ")}\n${stderr}`
  const requestError = (id, method) => new Error(`RPC request ${id} (${method}): ${failure}`)
  function fail(reason) {
    failure ??= reason
    for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(requestError(id, p.method)) }
    pending.clear()
  }
  function send(message) {
    if (failure) throw new Error(`RPC transport unavailable: ${failure}`)
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }))
    child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
    child.stdin.write(body)
  }
  function close() {
    fail("client closed")
    if (stopped) return closed
    if (!closing) {
      child.kill()
      const timer = setTimeout(() => child.kill("SIGKILL"), 1000)
      closing = closed.finally(() => clearTimeout(timer))
    }
    return closing
  }
  child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-12000) })
  child.stderr.on("error", error => fail(`stderr failed (${error.code ?? "read"})`))
  child.on("error", error => fail(`spawn failed (${error.code ?? "spawn"})`))
  child.stdin.on("error", error => fail(`stdin failed (${error.code ?? "write"})`))
  child.on("close", (code, signal) => { stopped = true; fail(`exited ${code}/${signal}`) })
  child.stdout.on("end", () => fail("stdout closed"))
  child.stdout.on("error", error => fail(`stdout failed (${error.code ?? "read"})`))
  child.stdout.on("data", chunk => {
    if (failure) return
    let stage = "headers"
    try {
      buffer = Buffer.concat([buffer, chunk])
      assert.ok(buffer.length <= 8 << 20, "RPC frame exceeds 8 MiB")
      for (;;) {
        stage = "headers"
        const end = buffer.indexOf("\r\n\r\n")
        if (end < 0) return
        const lengths = buffer.subarray(0, end).toString().split("\r\n").filter(line => /^Content-Length:/i.test(line))
        const match = lengths.length === 1 ? /^Content-Length: *(\d+) *$/i.exec(lengths[0]) : null
        assert.ok(match, "invalid RPC Content-Length")
        const length = Number(match[1])
        assert.ok(Number.isSafeInteger(length) && length <= 8 << 20, "invalid RPC frame length")
        if (buffer.length < end + 4 + length) return
        stage = "body"
        const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString())
        buffer = buffer.subarray(end + 4 + length)
        stage = "dispatch"
        assert.ok(message && typeof message === "object" && !Array.isArray(message), "invalid RPC message")
        if (message.method && message.id !== undefined) {
          send({ id: message.id, result: message.method === "workspace/configuration"
            ? message.params.items.map(() => null) : null })
        } else if (pending.has(message.id)) {
          const p = pending.get(message.id)
          pending.delete(message.id); clearTimeout(p.timer)
          if (message.error) p.reject(new Error(`${p.method}: ${JSON.stringify(message.error)}\n${log()}`))
          else p.resolve(message.result)
        }
      }
    } catch {
      // Parser errors can quote the response body; report only the protocol stage.
      fail(`invalid response at ${stage}`)
      void close()
    }
  })
  return {
    log,
    notify: (method, params) => send({ method, params }),
    request(method, params) {
      const id = ++nextId
      if (failure) return Promise.reject(requestError(id, method))
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { fail(`timeout at ${method}`); void close() }, 30000)
        pending.set(id, { resolve, reject, timer, method })
        try { send({ id, method, params }) }
        catch (error) { fail(`send failed (${error.code ?? "write"})`); void close() }
      })
    },
    close
  }
}

// Explicitly cross the protocol's UTF-8 and LSP's UTF-16 coordinate spaces.
export function position(text, byteOffset) {
  const bytes = Buffer.from(text), prefix = bytes.subarray(0, byteOffset).toString()
  assert.deepEqual(Buffer.from(prefix), bytes.subarray(0, byteOffset), "offset splits a UTF-8 code point")
  const lines = prefix.split("\n")
  return { line: lines.length - 1, character: lines.at(-1).length }
}

export function offset(text, point) {
  const lines = text.split("\n")
  assert.ok(point.line >= 0 && point.line < lines.length, "LSP line outside source")
  assert.ok(point.character >= 0 && point.character <= lines[point.line].length, "LSP column outside source")
  return Buffer.byteLength(lines.slice(0, point.line).map(line => line + "\n").join("") +
    lines[point.line].slice(0, point.character))
}

export async function languageServer(binary, root) {
  const rpc = client(binary, ["--lsp", "--stdio"], root)
  try {
    const uri = pathToFileURL(root).href
    const result = await rpc.request("initialize", { processId: process.pid, rootUri: uri,
      workspaceFolders: [{ uri, name: "M1" }], initializationOptions: { runExternalCode: true },
      capabilities: { general: { positionEncodings: ["utf-16"] }, workspace: { configuration: true },
        textDocument: { diagnostic: { dynamicRegistration: true }, rename: { prepareSupport: true } } } })
    assert.equal(result.capabilities.positionEncoding || "utf-16", "utf-16")
    rpc.notify("initialized", {})
    return rpc
  } catch (error) { await rpc.close(); throw error }
}
