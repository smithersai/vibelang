import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ResponseError, startServer } from "./lsp"

// A real stdio peer exercises framing and dispatch together without building a compiler.
const peer = String.raw`
let buffer = Buffer.alloc(0)
const send = (message) => {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }))
  const frame = Buffer.concat([Buffer.from("Content-Length: " + body.length + "\r\n\r\n"), body])
  // Split both the header and a multibyte payload between writes.
  const emoji = frame.indexOf(Buffer.from("🌍"))
  const split = emoji < 0 ? frame.length - 2 : emoji + 2
  process.stdout.write(frame.subarray(0, 8))
  setTimeout(() => process.stdout.write(frame.subarray(8, split)), 5)
  setTimeout(() => process.stdout.write(frame.subarray(split)), 10)
}
process.stdin.on("data", chunk => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const head = buffer.indexOf("\r\n\r\n")
    if (head < 0) break
    const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, head).toString())[1])
    if (buffer.length < head + 4 + length) break
    const message = JSON.parse(buffer.subarray(head + 4, head + 4 + length).toString())
    buffer = buffer.subarray(head + 4 + length)
    if (message.method === "echo") send({ id: message.id, result: message.params })
    else if (message.method === "fail") send({ id: message.id, error: { code: -32602, message: "invalid hover" } })
    else if (message.method === "settings") {
      globalThis.settingsId = message.id
      send({ id: "server-settings", method: "workspace/configuration", params: { items: [{}, {}] } })
    } else if (message.id === "server-settings") send({ id: globalThis.settingsId, result: message.result })
    else if (message.method === "shutdown") send({ id: message.id, result: null })
    else if (message.method === "exit") process.exit(0)
  }
})
`

test("stdio LSP dispatch preserves framed results, response errors and server settings", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vibelang-docs-lsp-"))
  const script = join(directory, "peer.mjs")
  writeFileSync(script, peer)
  const server = startServer([process.execPath, script])
  try {
    expect(await server.request("echo", { text: "héllo 🌍" })).toEqual({ text: "héllo 🌍" })
    try {
      await server.request("fail", null)
      throw new Error("the server response should reject")
    } catch (error) {
      expect(error).toBeInstanceOf(ResponseError)
      expect((error as ResponseError).code).toBe(-32602)
      expect((error as Error).message).toBe("invalid hover")
    }
    expect(await server.request("echo", 42)).toBe(42)
    expect(await server.request("settings", null)).toEqual([null, null])
  } finally {
    await server.close()
    rmSync(directory, { recursive: true, force: true })
  }
}, 10000)
