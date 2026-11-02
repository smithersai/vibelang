import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const client = process.env.DOCS_LSP_CLIENT ?? join(import.meta.dir, "lsp.ts")

// A subprocess keeps a client reader's unhandled rejection from taking down
// bun:test. The real peer stays alive after closing stdout or corrupting a
// frame, so only client teardown can reap it.
for (const mode of ["stdout-end", "stdout-end-ignore-term", "truncated-header", "truncated-body", "malformed-header", "malformed-negative-length", "malformed-duplicate-length", "malformed-unsafe-length", "malformed-json", "malformed-null", "malformed-array", "malformed-settings"]) {
  test("docs LSP rejects pending requests and reaps a broken stream: " + mode, () => {
    const directory = mkdtempSync(join(tmpdir(), "vibelang-docs-lsp-failure-"))
    const pidFile = join(directory, "peer.pid")
    try {
      const peer = join(directory, "peer.mjs")
      writeFileSync(peer, `
import { closeSync, writeFileSync, writeSync } from "node:fs"
writeFileSync(process.argv[3], String(process.pid))
if (process.argv[2] === "stdout-end-ignore-term") process.on("SIGTERM", () => {})
setInterval(() => {}, 1000)
process.stdin.once("data", () => {
  const mode = process.argv[2]
  if (mode.startsWith("stdout-end")) { closeSync(1); return }
  if (mode.startsWith("truncated-")) {
    writeSync(1, mode === "truncated-header" ? "Content-Len" : "Content-Length: 100\\r\\n\\r\\n{")
    closeSync(1); return
  }
  const body = mode === "malformed-null" ? "null" : mode === "malformed-array" ? "[]" : mode === "malformed-settings"
    ? JSON.stringify({jsonrpc: "2.0", id: "settings", method: "workspace/configuration", params: {items: null}})
    : "{PRIVATE_RESPONSE_BODY"
  const header = mode === "malformed-header" ? "Content-Type: application/json"
    : mode === "malformed-negative-length" ? "Content-Length: -1"
    : mode === "malformed-duplicate-length" ? "Content-Length: 1\\r\\nContent-Length: 2"
    : mode === "malformed-unsafe-length" ? "Content-Length: 9007199254740992"
    : "Content-Length: " + Buffer.byteLength(body)
  process.stdout.write(header + "\\r\\n\\r\\n" + body)
})
`)
      const worker = join(directory, "worker.ts")
      writeFileSync(worker, `
import assert from "node:assert/strict"
import { startServer } from ${JSON.stringify(pathToFileURL(client).href)}
const server = startServer([process.execPath, ${JSON.stringify(peer)}, ${JSON.stringify(mode)}, ${JSON.stringify(pidFile)}])
try {
  const results = await Promise.allSettled(["initialize", "textDocument/hover", "textDocument/diagnostic"].map(method => server.request(method, null)))
  for (const [index, result] of results.entries()) {
    assert.equal(result.status, "rejected")
    const message = result.reason.message
    assert.ok(message.includes(["initialize", "textDocument/hover", "textDocument/diagnostic"][index]), message)
    assert.match(message, /request [123]/)
    assert.match(message, ${mode.startsWith("stdout-end") || mode.startsWith("truncated-") ? "/stdout closed/" : mode === "malformed-json" ? "/malformed LSP JSON/" : ["malformed-null", "malformed-array", "malformed-settings"].includes(mode) ? "/malformed LSP message/" : "/malformed LSP header/"})
    assert.ok(!message.includes("PRIVATE_RESPONSE_BODY"))
  }
  await assert.rejects(server.request("later", null), /stdout closed|malformed LSP/)
  console.log("requests rejected")
} finally {
  await server.close()
  console.log("server reaped")
}
`)
      const result = Bun.spawnSync([process.execPath, worker], { stdout: "pipe", stderr: "pipe", timeout: 8000 })
      expect(result.exitCode, result.stdout.toString() + result.stderr.toString()).toBe(0)
      expect(result.stdout.toString()).toBe("requests rejected\nserver reaped\n")
      expect(result.stderr.toString()).not.toContain("PRIVATE_RESPONSE_BODY")
      const pid = Number(readFileSync(pidFile, "utf8"))
      let alive = false
      try { process.kill(pid, 0); alive = true } catch {}
      expect(alive, "client left its peer alive").toBe(false)
    } finally {
      // Baseline failures must not leave their deliberately live fixture behind.
      if (existsSync(pidFile)) {
        try { process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL") } catch {}
      }
      rmSync(directory, { recursive: true, force: true })
    }
  }, 12000)
}
